import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SSHConnection, SSHConnectionPool } from '../interfaces/ssh.interface';
import { SSHConnectionPoolError } from '../exceptions/ssh.exceptions';

@Injectable()
export class SSHConnectionPoolService implements SSHConnectionPool, OnModuleDestroy {
  private readonly logger = new Logger(SSHConnectionPoolService.name);
  private readonly connections = new Map<string, SSHConnection>();
  private readonly serverConnections = new Map<string, string[]>(); // serverId -> connectionIds
  private readonly maxPoolSize: number;
  private readonly maxIdleTime: number;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.maxPoolSize = this.configService.get<number>('SSH_POOL_MAX_SIZE', 50);
    this.maxIdleTime = this.configService.get<number>('SSH_POOL_MAX_IDLE_TIME', 300000); // 5 minutes
    
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections().catch(error => {
        this.logger.error('Error during connection cleanup', error);
      });
    }, 60000); // Run cleanup every minute
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    await this.closeAllConnections();
  }

  /**
   * Get or create a connection for a server
   */
  async getConnection(serverId: string): Promise<SSHConnection> {
    // Check if we have existing connections for this server
    const existingConnectionIds = this.serverConnections.get(serverId) || [];
    
    // Find an available connection
    for (const connectionId of existingConnectionIds) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.isConnected) {
        connection.lastUsed = new Date();
        this.logger.debug(`Reusing existing connection ${connectionId} for server ${serverId}`);
        return connection;
      }
    }

    // No available connection found, this should not happen in normal flow
    // The SSH service should create connections through the main SSH service
    throw new SSHConnectionPoolError(
      `No available connection found for server ${serverId}`,
      this.maxPoolSize,
      this.connections.size
    );
  }

  /**
   * Add a new connection to the pool
   */
  async addConnection(serverId: string, connection: SSHConnection): Promise<void> {
    // Check pool size limit
    if (this.connections.size >= this.maxPoolSize) {
      // Try to clean up idle connections first
      await this.cleanupIdleConnections();
      
      if (this.connections.size >= this.maxPoolSize) {
        throw new SSHConnectionPoolError(
          'Connection pool is full',
          this.maxPoolSize,
          this.connections.size
        );
      }
    }

    // Add connection to pool
    this.connections.set(connection.id, connection);
    
    // Track server connections
    const serverConnectionIds = this.serverConnections.get(serverId) || [];
    serverConnectionIds.push(connection.id);
    this.serverConnections.set(serverId, serverConnectionIds);

    this.logger.debug(`Added connection ${connection.id} for server ${serverId} to pool`);
  }

  /**
   * Release a connection (mark as available)
   */
  async releaseConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastUsed = new Date();
      this.logger.debug(`Released connection ${connectionId}`);
    }
  }

  /**
   * Close and remove a specific connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    try {
      if (connection.isConnected && connection.connection) {
        connection.connection.end();
      }
      connection.isConnected = false;
    } catch (error) {
      this.logger.error(`Error closing connection ${connectionId}`, error);
    }

    // Remove from pool
    this.connections.delete(connectionId);

    // Remove from server connections tracking
    for (const [serverId, connectionIds] of this.serverConnections.entries()) {
      const index = connectionIds.indexOf(connectionId);
      if (index !== -1) {
        connectionIds.splice(index, 1);
        if (connectionIds.length === 0) {
          this.serverConnections.delete(serverId);
        } else {
          this.serverConnections.set(serverId, connectionIds);
        }
        break;
      }
    }

    this.logger.debug(`Closed and removed connection ${connectionId} from pool`);
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const connectionIds = Array.from(this.connections.keys());
    
    await Promise.all(
      connectionIds.map(connectionId => this.closeConnection(connectionId))
    );

    this.connections.clear();
    this.serverConnections.clear();
    
    this.logger.log('Closed all connections in pool');
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): SSHConnection[] {
    return Array.from(this.connections.values()).filter(conn => conn.isConnected);
  }

  /**
   * Clean up idle connections
   */
  async cleanupIdleConnections(): Promise<void> {
    const now = new Date();
    const idleConnections: string[] = [];

    for (const [connectionId, connection] of this.connections.entries()) {
      const idleTime = now.getTime() - connection.lastUsed.getTime();
      
      if (idleTime > this.maxIdleTime) {
        idleConnections.push(connectionId);
      }
    }

    if (idleConnections.length > 0) {
      this.logger.debug(`Cleaning up ${idleConnections.length} idle connections`);
      
      await Promise.all(
        idleConnections.map(connectionId => this.closeConnection(connectionId))
      );
    }
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    maxPoolSize: number;
    serverCount: number;
  } {
    const activeConnections = this.getActiveConnections();
    
    return {
      totalConnections: this.connections.size,
      activeConnections: activeConnections.length,
      idleConnections: this.connections.size - activeConnections.length,
      maxPoolSize: this.maxPoolSize,
      serverCount: this.serverConnections.size,
    };
  }

  /**
   * Get connections for a specific server
   */
  getServerConnections(serverId: string): SSHConnection[] {
    const connectionIds = this.serverConnections.get(serverId) || [];
    return connectionIds
      .map(id => this.connections.get(id))
      .filter((conn): conn is SSHConnection => conn !== undefined);
  }

  /**
   * Check if server has active connections
   */
  hasActiveConnections(serverId: string): boolean {
    const connections = this.getServerConnections(serverId);
    return connections.some(conn => conn.isConnected);
  }

  /**
   * Close all connections for a specific server
   */
  async closeServerConnections(serverId: string): Promise<void> {
    const connectionIds = this.serverConnections.get(serverId) || [];
    
    await Promise.all(
      connectionIds.map(connectionId => this.closeConnection(connectionId))
    );

    this.logger.debug(`Closed all connections for server ${serverId}`);
  }
}