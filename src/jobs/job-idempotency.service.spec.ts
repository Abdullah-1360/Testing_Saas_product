import { Test, TestingModule } from '@nestjs/testing';
import { JobIdempotencyService, IdempotencyResult, JobCheckpoint } from './job-idempotency.service';
import { RedisConfigService } from '@/config/redis.config';
import { Redis } from 'ioredis';

// Mock Redis
const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  ttl: jest.fn(),
  quit: jest.fn(),
};

// Mock RedisConfigService
const mockRedisConfigService = {
  createRedisConnection: jest.fn().mockReturnValue(mockRedis),
};

describe('JobIdempotencyService', () => {
  let service: JobIdempotencyService;
  let redis: jest.Mocked<Redis>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobIdempotencyService,
        {
          provide: RedisConfigService,
          useValue: mockRedisConfigService,
        },
      ],
    }).compile();

    service = module.get<JobIdempotencyService>(JobIdempotencyService);
    redis = mockRedis as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate key without data', () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;

      // Act
      const key = service.generateIdempotencyKey(incidentId, state, attempt);

      // Assert
      expect(key).toBe('wp-autohealer:idempotency:incident-1:DISCOVERY:1:');
    });

    it('should generate key with data checksum', () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const data = { test: 'data', value: 123 };

      // Act
      const key = service.generateIdempotencyKey(incidentId, state, attempt, data);

      // Assert
      expect(key).toMatch(/^wp-autohealer:idempotency:incident-1:DISCOVERY:1:[a-f0-9]{16}$/);
    });

    it('should generate consistent keys for same data', () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const data = { test: 'data', value: 123 };

      // Act
      const key1 = service.generateIdempotencyKey(incidentId, state, attempt, data);
      const key2 = service.generateIdempotencyKey(incidentId, state, attempt, data);

      // Assert
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different data', () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const data1 = { test: 'data1' };
      const data2 = { test: 'data2' };

      // Act
      const key1 = service.generateIdempotencyKey(incidentId, state, attempt, data1);
      const key2 = service.generateIdempotencyKey(incidentId, state, attempt, data2);

      // Assert
      expect(key1).not.toBe(key2);
    });
  });

  describe('checkIdempotency', () => {
    it('should return not idempotent when no existing result', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      redis.get.mockResolvedValue(null);

      // Act
      const result = await service.checkIdempotency(incidentId, state, attempt);

      // Assert
      expect(result.isIdempotent).toBe(false);
      expect(result.existingResult).toBeUndefined();
      expect(result.key).toBe('wp-autohealer:idempotency:incident-1:DISCOVERY:1:');
    });

    it('should return idempotent when existing result found', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const existingResult = { status: 'completed', data: 'test' };
      redis.get.mockResolvedValue(JSON.stringify(existingResult));

      // Act
      const result = await service.checkIdempotency(incidentId, state, attempt);

      // Assert
      expect(result.isIdempotent).toBe(true);
      expect(result.existingResult).toEqual(existingResult);
      expect(result.key).toBe('wp-autohealer:idempotency:incident-1:DISCOVERY:1:');
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      redis.get.mockRejectedValue(new Error('Redis connection failed'));

      // Act
      const result = await service.checkIdempotency(incidentId, state, attempt);

      // Assert
      expect(result.isIdempotent).toBe(false);
      expect(result.existingResult).toBeUndefined();
    });

    it('should handle invalid JSON gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      redis.get.mockResolvedValue('invalid-json');

      // Act & Assert
      await expect(service.checkIdempotency(incidentId, state, attempt)).rejects.toThrow();
    });
  });

  describe('storeResult', () => {
    it('should store result with default TTL', async () => {
      // Arrange
      const key = 'test-key';
      const result = { status: 'completed', data: 'test' };
      redis.setex.mockResolvedValue('OK');

      // Act
      await service.storeResult(key, result);

      // Assert
      expect(redis.setex).toHaveBeenCalledWith(
        key,
        24 * 60 * 60, // Default TTL
        JSON.stringify(result)
      );
    });

    it('should store result with custom TTL', async () => {
      // Arrange
      const key = 'test-key';
      const result = { status: 'completed' };
      const customTtl = 3600;
      redis.setex.mockResolvedValue('OK');

      // Act
      await service.storeResult(key, result, customTtl);

      // Assert
      expect(redis.setex).toHaveBeenCalledWith(key, customTtl, JSON.stringify(result));
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const key = 'test-key';
      const result = { status: 'completed' };
      redis.setex.mockRejectedValue(new Error('Redis write failed'));

      // Act & Assert - Should not throw
      await expect(service.storeResult(key, result)).resolves.toBeUndefined();
    });
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const progress = 50;
      const data = { step: 'analyzing' };
      redis.setex.mockResolvedValue('OK');

      // Act
      await service.createCheckpoint(incidentId, state, attempt, progress, data);

      // Assert
      expect(redis.setex).toHaveBeenCalledWith(
        'wp-autohealer:checkpoint:incident-1:DISCOVERY:1',
        24 * 60 * 60,
        expect.stringContaining('"progress":50')
      );

      const storedData = JSON.parse(redis.setex.mock.calls[0][2]);
      expect(storedData).toMatchObject({
        incidentId,
        state,
        attempt,
        progress,
        data,
        checksum: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const progress = 50;
      const data = { step: 'analyzing' };
      redis.setex.mockRejectedValue(new Error('Redis write failed'));

      // Act & Assert - Should not throw
      await expect(
        service.createCheckpoint(incidentId, state, attempt, progress, data)
      ).resolves.toBeUndefined();
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should retrieve checkpoint successfully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      const checkpoint = {
        incidentId,
        state,
        attempt,
        progress: 75,
        data: { step: 'completed' },
        timestamp: new Date().toISOString(),
        checksum: 'abc123',
      };
      redis.get.mockResolvedValue(JSON.stringify(checkpoint));

      // Act
      const result = await service.getLatestCheckpoint(incidentId, state, attempt);

      // Assert
      expect(result).toMatchObject({
        incidentId,
        state,
        attempt,
        progress: 75,
        data: { step: 'completed' },
        checksum: 'abc123',
      });
      expect(result?.timestamp).toBeInstanceOf(Date);
    });

    it('should return null when no checkpoint exists', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      redis.get.mockResolvedValue(null);

      // Act
      const result = await service.getLatestCheckpoint(incidentId, state, attempt);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const state = 'DISCOVERY';
      const attempt = 1;
      redis.get.mockRejectedValue(new Error('Redis read failed'));

      // Act
      const result = await service.getLatestCheckpoint(incidentId, state, attempt);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getIncidentCheckpoints', () => {
    it('should retrieve all checkpoints for incident', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const keys = [
        'wp-autohealer:checkpoint:incident-1:DISCOVERY:1',
        'wp-autohealer:checkpoint:incident-1:BASELINE:1',
      ];
      const checkpoints = [
        {
          incidentId,
          state: 'DISCOVERY',
          attempt: 1,
          progress: 50,
          data: {},
          timestamp: new Date('2024-01-15T10:00:00Z').toISOString(),
          checksum: 'abc123',
        },
        {
          incidentId,
          state: 'BASELINE',
          attempt: 1,
          progress: 75,
          data: {},
          timestamp: new Date('2024-01-15T10:05:00Z').toISOString(),
          checksum: 'def456',
        },
      ];

      redis.keys.mockResolvedValue(keys);
      redis.get
        .mockResolvedValueOnce(JSON.stringify(checkpoints[0]))
        .mockResolvedValueOnce(JSON.stringify(checkpoints[1]));

      // Act
      const result = await service.getIncidentCheckpoints(incidentId);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].state).toBe('DISCOVERY');
      expect(result[1].state).toBe('BASELINE');
      expect(result[0].timestamp).toBeInstanceOf(Date);
      expect(result[1].timestamp).toBeInstanceOf(Date);
      // Should be sorted by timestamp
      expect(result[0].timestamp.getTime()).toBeLessThan(result[1].timestamp.getTime());
    });

    it('should return empty array when no checkpoints exist', async () => {
      // Arrange
      const incidentId = 'incident-1';
      redis.keys.mockResolvedValue([]);

      // Act
      const result = await service.getIncidentCheckpoints(incidentId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      redis.keys.mockRejectedValue(new Error('Redis keys failed'));

      // Act
      const result = await service.getIncidentCheckpoints(incidentId);

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should clean up old keys and checkpoints', async () => {
      // Arrange
      const idempotencyKeys = ['wp-autohealer:idempotency:old-key'];
      const checkpointKeys = ['wp-autohealer:checkpoint:old-checkpoint'];
      const oldCheckpoint = {
        timestamp: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(), // 50 hours ago
      };

      redis.keys
        .mockResolvedValueOnce(idempotencyKeys)
        .mockResolvedValueOnce(checkpointKeys);
      redis.ttl.mockResolvedValue(500); // Low TTL
      redis.get.mockResolvedValue(JSON.stringify(oldCheckpoint));
      redis.del.mockResolvedValue(1);

      // Act
      await service.cleanup(48);

      // Assert
      expect(redis.del).toHaveBeenCalledWith(idempotencyKeys[0]);
      expect(redis.del).toHaveBeenCalledWith(checkpointKeys[0]);
    });

    it('should handle cleanup errors gracefully', async () => {
      // Arrange
      redis.keys.mockRejectedValue(new Error('Redis keys failed'));

      // Act & Assert - Should not throw
      await expect(service.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('clearIncidentData', () => {
    it('should clear all data for incident', async () => {
      // Arrange
      const incidentId = 'incident-1';
      const idempotencyKeys = ['wp-autohealer:idempotency:incident-1:key1'];
      const checkpointKeys = ['wp-autohealer:checkpoint:incident-1:key1'];

      redis.keys
        .mockResolvedValueOnce(idempotencyKeys)
        .mockResolvedValueOnce(checkpointKeys);
      redis.del.mockResolvedValue(1);

      // Act
      await service.clearIncidentData(incidentId);

      // Assert
      expect(redis.del).toHaveBeenCalledWith(...idempotencyKeys);
      expect(redis.del).toHaveBeenCalledWith(...checkpointKeys);
    });

    it('should handle empty key arrays', async () => {
      // Arrange
      const incidentId = 'incident-1';
      redis.keys.mockResolvedValue([]);

      // Act & Assert - Should not throw
      await expect(service.clearIncidentData(incidentId)).resolves.toBeUndefined();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      const incidentId = 'incident-1';
      redis.keys.mockRejectedValue(new Error('Redis keys failed'));

      // Act & Assert - Should not throw
      await expect(service.clearIncidentData(incidentId)).resolves.toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      // Arrange
      const idempotencyKeys = ['key1', 'key2'];
      const checkpointKeys = ['checkpoint1'];
      redis.keys
        .mockResolvedValueOnce(idempotencyKeys)
        .mockResolvedValueOnce(checkpointKeys);
      redis.get.mockResolvedValue('{"test":"data"}');

      // Act
      const stats = await service.getStats();

      // Assert
      expect(stats).toEqual({
        idempotencyKeys: 2,
        checkpoints: 1,
        totalMemoryUsage: expect.any(Number),
      });
      expect(stats.totalMemoryUsage).toBeGreaterThan(0);
    });

    it('should handle Redis errors gracefully', async () => {
      // Arrange
      redis.keys.mockRejectedValue(new Error('Redis keys failed'));

      // Act
      const stats = await service.getStats();

      // Assert
      expect(stats).toEqual({
        idempotencyKeys: 0,
        checkpoints: 0,
        totalMemoryUsage: 0,
      });
    });
  });

  describe('close', () => {
    it('should close Redis connection', async () => {
      // Act
      await service.close();

      // Assert
      expect(redis.quit).toHaveBeenCalled();
    });
  });

  describe('checksum generation', () => {
    it('should generate consistent checksums for same data', () => {
      // Arrange
      const data1 = { b: 2, a: 1 };
      const data2 = { a: 1, b: 2 };

      // Act
      const key1 = service.generateIdempotencyKey('incident-1', 'state', 1, data1);
      const key2 = service.generateIdempotencyKey('incident-1', 'state', 1, data2);

      // Assert
      expect(key1).toBe(key2); // Should be same due to sorted keys
    });

    it('should generate different checksums for different data', () => {
      // Arrange
      const data1 = { a: 1, b: 2 };
      const data2 = { a: 1, b: 3 };

      // Act
      const key1 = service.generateIdempotencyKey('incident-1', 'state', 1, data1);
      const key2 = service.generateIdempotencyKey('incident-1', 'state', 1, data2);

      // Assert
      expect(key1).not.toBe(key2);
    });
  });
});