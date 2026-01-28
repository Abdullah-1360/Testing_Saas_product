import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SSHConnectionPoolService } from './ssh-connection-pool.service';
import { SSHConnection } from '../interfaces/ssh.interface';
import { SSHConnectionPoolError } from '../exceptions/ssh.exceptions';

describe('SSHConnectionPoolService', () => {
  let service: SSHConnectionPoolService;
  let configService: jest.Mocked<ConfigService>;

  const mockConnection = (id: string, serverId: string, isConnected = true): SSHConnection => ({
    id,
    serverId,
    hostname: 'test.example.com',
    port: 22,
    username: 'testuser',
    isConnected,
    connection: {
      end: jest.fn(),
    } as any,
    createdAt: new Date(),
    lastUsed: new Date(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SSHConnectionPoolService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                SSH_POOL_MAX_SIZE: 50,
                SSH_POOL_MAX_IDLE_TIME: 300000, // 5 minutes
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SSHConnectionPoolService>(SSHConnectionPoolService);
    configService = module.get(ConfigService);

    // Clear any existing timers
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      expect(configService.get).toHaveBeenCalledWith('SSH_POOL_MAX_SIZE', 50);
      expect(configService.get).toHaveBeenCalledWith('SSH_POOL_MAX_IDLE_TIME', 300000);
    });

    it('should start cleanup interval', () => {
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
    });
  });

  describe('addConnection', () => {
    it('should add a connection to the pool', async () => {
      const connection = mockConnection('conn-1', 'server-1');

      await service.addConnection('server-1', connection);

      const stats = service.getPoolStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.serverCount).toBe(1);
    });

    it('should track multiple connections for the same server', async () => {
      const connection1 = mockConnection('conn-1', 'server-1');
      const connection2 = mockConnection('conn-2', 'server-1');

      await service.addConnection('server-1', connection1);
      await service.addConnection('server-1', connection2);

      const serverConnections = service.getServerConnections('server-1');
      expect(serverConnections).toHaveLength(2);
      expect(serverConnections.map(c => c.id)).toContain('conn-1');
      expect(serverConnections.map(c => c.id)).toContain('conn-2');
    });

    it('should throw error when pool is full', async () => {
      // Mock a smaller pool size
      configService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'SSH_POOL_MAX_SIZE') return 2;
        if (key === 'SSH_POOL_MAX_IDLE_TIME') return 300000;
        return defaultValue;
      });

      // Create new service instance with smaller pool
      const module = await Test.createTestingModule({
        providers: [
          SSHConnectionPoolService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const smallPoolService = module.get<SSHConnectionPoolService>(SSHConnectionPoolService);

      // Fill the pool
      await smallPoolService.addConnection('server-1', mockConnection('conn-1', 'server-1'));
      await smallPoolService.addConnection('server-2', mockConnection('conn-2', 'server-2'));

      // Try to add one more
      const connection3 = mockConnection('conn-3', 'server-3');
      await expect(smallPoolService.addConnection('server-3', connection3))
        .rejects
        .toThrow(SSHConnectionPoolError);

      await smallPoolService.onModuleDestroy();
    });
  });

  describe('getConnection', () => {
    it('should return existing connected connection', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      await service.addConnection('server-1', connection);

      const result = await service.getConnection('server-1');

      expect(result).toBe(connection);
      expect(result.lastUsed).toBeInstanceOf(Date);
    });

    it('should skip disconnected connections', async () => {
      const disconnectedConnection = mockConnection('conn-1', 'server-1', false);
      const connectedConnection = mockConnection('conn-2', 'server-1', true);

      await service.addConnection('server-1', disconnectedConnection);
      await service.addConnection('server-1', connectedConnection);

      const result = await service.getConnection('server-1');

      expect(result).toBe(connectedConnection);
    });

    it('should throw error when no connections available', async () => {
      await expect(service.getConnection('nonexistent-server'))
        .rejects
        .toThrow(SSHConnectionPoolError);
    });

    it('should throw error when all connections are disconnected', async () => {
      const disconnectedConnection = mockConnection('conn-1', 'server-1', false);
      await service.addConnection('server-1', disconnectedConnection);

      await expect(service.getConnection('server-1'))
        .rejects
        .toThrow(SSHConnectionPoolError);
    });
  });

  describe('releaseConnection', () => {
    it('should update lastUsed timestamp', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      const originalLastUsed = connection.lastUsed;
      await service.addConnection('server-1', connection);

      // Wait a bit to ensure timestamp difference
      jest.advanceTimersByTime(1000);

      await service.releaseConnection('conn-1');

      expect(connection.lastUsed.getTime()).toBeGreaterThan(originalLastUsed.getTime());
    });

    it('should handle non-existent connection gracefully', async () => {
      await expect(service.releaseConnection('nonexistent-conn'))
        .resolves
        .not.toThrow();
    });
  });

  describe('closeConnection', () => {
    it('should close and remove connection', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      await service.addConnection('server-1', connection);

      await service.closeConnection('conn-1');

      expect(connection.connection.end).toHaveBeenCalled();
      expect(connection.isConnected).toBe(false);
      expect(service.getPoolStats().totalConnections).toBe(0);
    });

    it('should remove connection from server tracking', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      await service.addConnection('server-1', connection);

      await service.closeConnection('conn-1');

      expect(service.getServerConnections('server-1')).toHaveLength(0);
      expect(service.getPoolStats().serverCount).toBe(0);
    });

    it('should handle connection close errors gracefully', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      connection.connection.end = jest.fn().mockImplementation(() => {
        throw new Error('Connection close error');
      });
      await service.addConnection('server-1', connection);

      await expect(service.closeConnection('conn-1'))
        .resolves
        .not.toThrow();

      expect(service.getPoolStats().totalConnections).toBe(0);
    });

    it('should handle non-existent connection gracefully', async () => {
      await expect(service.closeConnection('nonexistent-conn'))
        .resolves
        .not.toThrow();
    });
  });

  describe('closeAllConnections', () => {
    it('should close all connections in pool', async () => {
      const connection1 = mockConnection('conn-1', 'server-1');
      const connection2 = mockConnection('conn-2', 'server-2');

      await service.addConnection('server-1', connection1);
      await service.addConnection('server-2', connection2);

      await service.closeAllConnections();

      expect(connection1.connection.end).toHaveBeenCalled();
      expect(connection2.connection.end).toHaveBeenCalled();
      expect(service.getPoolStats().totalConnections).toBe(0);
      expect(service.getPoolStats().serverCount).toBe(0);
    });
  });

  describe('getActiveConnections', () => {
    it('should return only connected connections', async () => {
      const connectedConnection = mockConnection('conn-1', 'server-1', true);
      const disconnectedConnection = mockConnection('conn-2', 'server-2', false);

      await service.addConnection('server-1', connectedConnection);
      await service.addConnection('server-2', disconnectedConnection);

      const activeConnections = service.getActiveConnections();

      expect(activeConnections).toHaveLength(1);
      expect(activeConnections[0]).toBe(connectedConnection);
    });
  });

  describe('cleanupIdleConnections', () => {
    it('should remove idle connections', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      // Set lastUsed to 10 minutes ago (older than 5 minute threshold)
      connection.lastUsed = new Date(Date.now() - 600000);
      await service.addConnection('server-1', connection);

      await service.cleanupIdleConnections();

      expect(service.getPoolStats().totalConnections).toBe(0);
    });

    it('should keep active connections', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      // Set lastUsed to 1 minute ago (within 5 minute threshold)
      connection.lastUsed = new Date(Date.now() - 60000);
      await service.addConnection('server-1', connection);

      await service.cleanupIdleConnections();

      expect(service.getPoolStats().totalConnections).toBe(1);
    });

    it('should be called automatically by cleanup interval', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      connection.lastUsed = new Date(Date.now() - 600000); // 10 minutes ago
      await service.addConnection('server-1', connection);

      // Advance timer to trigger cleanup
      jest.advanceTimersByTime(60000);

      // Wait for async cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(service.getPoolStats().totalConnections).toBe(0);
    });
  });

  describe('getPoolStats', () => {
    it('should return accurate pool statistics', async () => {
      const connectedConnection = mockConnection('conn-1', 'server-1', true);
      const disconnectedConnection = mockConnection('conn-2', 'server-2', false);

      await service.addConnection('server-1', connectedConnection);
      await service.addConnection('server-2', disconnectedConnection);

      const stats = service.getPoolStats();

      expect(stats).toEqual({
        totalConnections: 2,
        activeConnections: 1,
        idleConnections: 1,
        maxPoolSize: 50,
        serverCount: 2,
      });
    });
  });

  describe('getServerConnections', () => {
    it('should return connections for specific server', async () => {
      const connection1 = mockConnection('conn-1', 'server-1');
      const connection2 = mockConnection('conn-2', 'server-1');
      const connection3 = mockConnection('conn-3', 'server-2');

      await service.addConnection('server-1', connection1);
      await service.addConnection('server-1', connection2);
      await service.addConnection('server-2', connection3);

      const server1Connections = service.getServerConnections('server-1');
      const server2Connections = service.getServerConnections('server-2');

      expect(server1Connections).toHaveLength(2);
      expect(server2Connections).toHaveLength(1);
      expect(server1Connections.map(c => c.id)).toEqual(['conn-1', 'conn-2']);
    });

    it('should return empty array for non-existent server', () => {
      const connections = service.getServerConnections('nonexistent-server');
      expect(connections).toEqual([]);
    });
  });

  describe('hasActiveConnections', () => {
    it('should return true when server has active connections', async () => {
      const connection = mockConnection('conn-1', 'server-1', true);
      await service.addConnection('server-1', connection);

      expect(service.hasActiveConnections('server-1')).toBe(true);
    });

    it('should return false when server has no active connections', async () => {
      const connection = mockConnection('conn-1', 'server-1', false);
      await service.addConnection('server-1', connection);

      expect(service.hasActiveConnections('server-1')).toBe(false);
    });

    it('should return false for non-existent server', () => {
      expect(service.hasActiveConnections('nonexistent-server')).toBe(false);
    });
  });

  describe('closeServerConnections', () => {
    it('should close all connections for specific server', async () => {
      const connection1 = mockConnection('conn-1', 'server-1');
      const connection2 = mockConnection('conn-2', 'server-1');
      const connection3 = mockConnection('conn-3', 'server-2');

      await service.addConnection('server-1', connection1);
      await service.addConnection('server-1', connection2);
      await service.addConnection('server-2', connection3);

      await service.closeServerConnections('server-1');

      expect(connection1.connection.end).toHaveBeenCalled();
      expect(connection2.connection.end).toHaveBeenCalled();
      expect(connection3.connection.end).not.toHaveBeenCalled();

      expect(service.getServerConnections('server-1')).toHaveLength(0);
      expect(service.getServerConnections('server-2')).toHaveLength(1);
    });

    it('should handle non-existent server gracefully', async () => {
      await expect(service.closeServerConnections('nonexistent-server'))
        .resolves
        .not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear cleanup interval and close all connections', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      await service.addConnection('server-1', connection);

      await service.onModuleDestroy();

      expect(clearInterval).toHaveBeenCalled();
      expect(connection.connection.end).toHaveBeenCalled();
      expect(service.getPoolStats().totalConnections).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle cleanup errors gracefully', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      connection.connection.end = jest.fn().mockImplementation(() => {
        throw new Error('Cleanup error');
      });
      connection.lastUsed = new Date(Date.now() - 600000); // 10 minutes ago
      await service.addConnection('server-1', connection);

      // Should not throw error
      await expect(service.cleanupIdleConnections())
        .resolves
        .not.toThrow();
    });

    it('should handle automatic cleanup errors', async () => {
      const connection = mockConnection('conn-1', 'server-1');
      connection.connection.end = jest.fn().mockImplementation(() => {
        throw new Error('Cleanup error');
      });
      connection.lastUsed = new Date(Date.now() - 600000);
      await service.addConnection('server-1', connection);

      // Advance timer to trigger cleanup - should not crash
      jest.advanceTimersByTime(60000);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Service should still be functional
      expect(service.getPoolStats()).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle pool size of 0', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'SSH_POOL_MAX_SIZE') return 0;
        if (key === 'SSH_POOL_MAX_IDLE_TIME') return 300000;
        return defaultValue;
      });

      const module = await Test.createTestingModule({
        providers: [
          SSHConnectionPoolService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const zeroPoolService = module.get<SSHConnectionPoolService>(SSHConnectionPoolService);

      const connection = mockConnection('conn-1', 'server-1');
      await expect(zeroPoolService.addConnection('server-1', connection))
        .rejects
        .toThrow(SSHConnectionPoolError);

      await zeroPoolService.onModuleDestroy();
    });

    it('should handle very short idle time', async () => {
      configService.get.mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'SSH_POOL_MAX_SIZE') return 50;
        if (key === 'SSH_POOL_MAX_IDLE_TIME') return 1; // 1ms
        return defaultValue;
      });

      const module = await Test.createTestingModule({
        providers: [
          SSHConnectionPoolService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();
      const shortIdleService = module.get<SSHConnectionPoolService>(SSHConnectionPoolService);

      const connection = mockConnection('conn-1', 'server-1');
      await shortIdleService.addConnection('server-1', connection);

      // Wait longer than idle time
      jest.advanceTimersByTime(2);

      await shortIdleService.cleanupIdleConnections();

      expect(shortIdleService.getPoolStats().totalConnections).toBe(0);
      await shortIdleService.onModuleDestroy();
    });
  });
});