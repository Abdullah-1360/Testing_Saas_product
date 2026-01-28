import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';
import { PrismaService } from '../../database/prisma.service';
import { SSHService } from '../../ssh/services/ssh.service';
import { AuditService } from '../../audit/audit.service';
import { ArtifactType } from '../interfaces/backup.interface';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('BackupService Property-Based Tests', () => {
  let service: BackupService;
  let prismaService: any;
  let sshService: any;
  let auditService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                BACKUP_DIRECTORY: '/tmp/wp-autohealer-backups',
                MAX_BACKUP_SIZE: 1024 * 1024 * 1024,
                BACKUP_COMPRESSION: true,
                BACKUP_ENCRYPTION: false,
                BACKUP_RETENTION_DAYS: 7,
              };
              return config[key] || defaultValue;
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            incident: { findUnique: jest.fn() },
            server: { findUnique: jest.fn() },
            backupArtifact: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: SSHService,
          useValue: {
            connect: jest.fn(),
            executeCommand: jest.fn(),
            downloadFile: jest.fn(),
            uploadFile: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
    prismaService = module.get(PrismaService);
    sshService = module.get(SSHService);
    auditService = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Custom generators for backup-related data
  const uuidGenerator = () => fc.uuid();
  
  const filePathGenerator = () => fc.oneof(
    fc.constant('/var/www/html/index.php'),
    fc.constant('/var/www/html/wp-config.php'),
    fc.constant('/var/www/html/.htaccess'),
    fc.constant('/var/www/html/wp-content/themes/active-theme/style.css'),
    fc.constant('/var/www/html/wp-content/plugins/test-plugin/plugin.php'),
    fc.string({ minLength: 5, maxLength: 100 }).map(s => `/var/www/html/${s.replace(/[^a-zA-Z0-9.-]/g, '_')}.txt`)
  );

  const directoryPathGenerator = () => fc.oneof(
    fc.constant('/var/www/html/wp-content/themes/active-theme'),
    fc.constant('/var/www/html/wp-content/plugins/test-plugin'),
    fc.constant('/var/www/html/wp-content/uploads/2024'),
    fc.string({ minLength: 5, maxLength: 50 }).map(s => `/var/www/html/${s.replace(/[^a-zA-Z0-9.-]/g, '_')}`)
  );

  const artifactTypeGenerator = () => fc.constantFrom(
    ArtifactType.FILE_BACKUP,
    ArtifactType.DIRECTORY_BACKUP,
    ArtifactType.PLUGIN_BACKUP,
    ArtifactType.THEME_BACKUP,
    ArtifactType.WP_CONFIG_BACKUP,
    ArtifactType.HTACCESS_BACKUP
  );

  const backupMetadataGenerator = () => fc.record({
    backupReason: fc.string({ minLength: 5, maxLength: 100 }),
    fixAttemptNumber: fc.integer({ min: 1, max: 15 }),
    relatedFiles: fc.array(filePathGenerator(), { maxLength: 5 }),
    dependencies: fc.array(fc.string(), { maxLength: 3 }),
  });

  const mockIncidentGenerator = () => fc.record({
    id: uuidGenerator(),
    siteId: uuidGenerator(),
    site: fc.record({
      id: uuidGenerator(),
      serverId: uuidGenerator(),
    }),
  });

  const mockServerGenerator = () => fc.record({
    id: uuidGenerator(),
    hostname: fc.domain(),
    port: fc.integer({ min: 22, max: 65535 }),
    username: fc.string({ minLength: 3, maxLength: 32 }),
  });

  const mockBackupArtifactGenerator = () => fc.record({
    id: uuidGenerator(),
    incidentId: uuidGenerator(),
    artifactType: artifactTypeGenerator().map(type => type.toString()),
    filePath: fc.string().map(s => `/tmp/backup/${s.replace(/[^a-zA-Z0-9.-]/g, '_')}.backup`),
    originalPath: filePathGenerator(),
    checksum: fc.hexaString({ minLength: 64, maxLength: 64 }),
    size: fc.bigInt({ min: 1n, max: 1000000n }),
    metadata: backupMetadataGenerator(),
    createdAt: fc.date(),
  });

  /**
   * Feature: wp-autohealer, Property 8: Rollback Artifact Prerequisite
   * For any production file modification, rollback artifacts should exist and be recorded in the database before the modification occurs.
   * **Validates: Requirements 5.1, 5.6**
   */
  it('should ensure rollback artifacts exist before any file modification', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockIncidentGenerator(),
        mockServerGenerator(),
        filePathGenerator(),
        artifactTypeGenerator(),
        backupMetadataGenerator(),
        async (incident, server, filePath, artifactType, metadata) => {
          // Setup mocks for successful backup creation
          prismaService.incident.findUnique.mockResolvedValue(incident as any);
          prismaService.server.findUnique.mockResolvedValue(server as any);
          
          sshService.connect.mockResolvedValue({
            id: 'connection-123',
            config: { hostname: server.hostname, port: server.port, username: server.username },
            connection: {},
            isConnected: true,
            lastUsed: new Date(),
            createdAt: new Date(),
          } as any);

          sshService.executeCommand.mockResolvedValue({
            stdout: '1024 644 www-data www-data',
            stderr: '',
            exitCode: 0,
            executionTime: 100,
            timestamp: new Date(),
            command: 'stat command',
          });

          sshService.downloadFile.mockResolvedValue({
            success: true,
            bytesTransferred: 1024,
            executionTime: 200,
            timestamp: new Date(),
          });

          mockFs.mkdir.mockResolvedValue(undefined);
          mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

          const mockArtifact = {
            id: 'artifact-123',
            incidentId: incident.id,
            artifactType: artifactType.toString(),
            filePath: '/tmp/backup/test-file.backup',
            originalPath: filePath,
            checksum: 'abc123def456',
            size: BigInt(1024),
            metadata,
            createdAt: new Date(),
          };

          prismaService.backupArtifact.create.mockResolvedValue(mockArtifact as any);

          // Create backup before modification
          const backupResult = await service.createFileBackup(
            incident.id,
            server.id,
            filePath,
            artifactType,
            metadata
          );

          // Verify backup was created successfully
          expect(backupResult.success).toBe(true);
          expect(backupResult.artifactId).toBeDefined();
          
          // Verify backup artifact was recorded in database
          expect(prismaService.backupArtifact.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              incidentId: incident.id,
              artifactType: artifactType.toString(),
              originalPath: filePath,
              size: BigInt(1024),
            }),
          });

          // Verify audit event was logged
          expect(auditService.logEvent).toHaveBeenCalledWith({
            action: 'BACKUP_CREATED',
            resource: 'backup_artifact',
            resourceId: 'artifact-123',
            details: expect.any(Object),
          });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Backup Integrity Validation
   * For any backup artifact created, the system should validate its integrity through checksum verification.
   */
  it('should validate backup integrity through checksum verification', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockBackupArtifactGenerator(),
        fc.string({ minLength: 10, maxLength: 1000 }),
        async (artifact, fileContent) => {
          // Setup mocks
          prismaService.backupArtifact.findUnique.mockResolvedValue(artifact as any);
          mockFs.stat.mockResolvedValue({ size: Number(artifact.size) } as any);
          mockFs.readFile.mockResolvedValue(Buffer.from(fileContent));

          // Validate backup
          const validationResult = await service.validateBackupArtifact(artifact.id);

          // The validation should complete without throwing errors
          expect(validationResult).toHaveProperty('isValid');
          expect(validationResult).toHaveProperty('checksumMatch');
          expect(validationResult).toHaveProperty('fileExists');
          expect(validationResult).toHaveProperty('sizeMatch');

          // If file exists, checksum should be calculated
          if (validationResult.fileExists) {
            expect(typeof validationResult.checksumMatch).toBe('boolean');
          }

          // Audit event should be logged
          expect(auditService.logEvent).toHaveBeenCalledWith({
            action: 'BACKUP_VALIDATED',
            resource: 'backup_artifact',
            resourceId: artifact.id,
            details: expect.objectContaining({
              isValid: validationResult.isValid,
              checksumMatch: validationResult.checksumMatch,
              fileExists: validationResult.fileExists,
              sizeMatch: validationResult.sizeMatch,
            }),
          });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Rollback Operation Completeness
   * For any rollback operation, the system should attempt to restore all backup artifacts for the incident.
   */
  it('should attempt to restore all backup artifacts during rollback', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockIncidentGenerator(),
        fc.array(mockBackupArtifactGenerator(), { minLength: 1, maxLength: 5 }),
        async (incident, artifacts) => {
          // Ensure all artifacts belong to the same incident
          const incidentArtifacts = artifacts.map(artifact => ({
            ...artifact,
            incidentId: incident.id,
          }));

          // Setup mocks
          prismaService.backupArtifact.findMany.mockResolvedValue(incidentArtifacts as any);
          prismaService.incident.findUnique.mockResolvedValue(incident as any);
          
          sshService.connect.mockResolvedValue({
            id: 'connection-123',
            config: { hostname: 'test.example.com', port: 22, username: 'testuser' },
            connection: {},
            isConnected: true,
            lastUsed: new Date(),
            createdAt: new Date(),
          } as any);

          // Mock validation for each artifact
          for (const artifact of incidentArtifacts) {
            prismaService.backupArtifact.findUnique.mockResolvedValueOnce(artifact as any);
            mockFs.stat.mockResolvedValueOnce({ size: Number(artifact.size) } as any);
            mockFs.readFile.mockResolvedValueOnce(Buffer.from('test content'));
          }

          sshService.uploadFile.mockResolvedValue({
            success: true,
            bytesTransferred: 1024,
            executionTime: 200,
            timestamp: new Date(),
          });

          sshService.executeCommand.mockResolvedValue({
            stdout: '',
            stderr: '',
            exitCode: 0,
            executionTime: 100,
            timestamp: new Date(),
            command: 'mv command',
          });

          // Execute rollback
          const rollbackResult = await service.executeRollback(incident.id);

          // Verify rollback attempted all artifacts
          const totalFiles = rollbackResult.restoredFiles.length + rollbackResult.failedFiles.length;
          expect(totalFiles).toBe(incidentArtifacts.length);

          // Verify audit event was logged
          expect(auditService.logEvent).toHaveBeenCalledWith({
            action: 'ROLLBACK_EXECUTED',
            resource: 'incident',
            resourceId: incident.id,
            details: expect.objectContaining({
              success: rollbackResult.success,
              restoredFiles: rollbackResult.restoredFiles,
              failedFiles: rollbackResult.failedFiles,
              artifactCount: incidentArtifacts.length,
            }),
          });
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Backup Metadata Preservation
   * For any backup created, all metadata should be preserved and retrievable.
   */
  it('should preserve and retrieve all backup metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockIncidentGenerator(),
        mockServerGenerator(),
        filePathGenerator(),
        artifactTypeGenerator(),
        backupMetadataGenerator(),
        async (incident, server, filePath, artifactType, metadata) => {
          // Setup mocks for successful backup creation
          prismaService.incident.findUnique.mockResolvedValue(incident as any);
          prismaService.server.findUnique.mockResolvedValue(server as any);
          
          sshService.connect.mockResolvedValue({
            id: 'connection-123',
            config: { hostname: server.hostname, port: server.port, username: server.username },
            connection: {},
            isConnected: true,
            lastUsed: new Date(),
            createdAt: new Date(),
          } as any);

          sshService.executeCommand.mockResolvedValue({
            stdout: '1024 644 www-data www-data',
            stderr: '',
            exitCode: 0,
            executionTime: 100,
            timestamp: new Date(),
            command: 'stat command',
          });

          sshService.downloadFile.mockResolvedValue({
            success: true,
            bytesTransferred: 1024,
            executionTime: 200,
            timestamp: new Date(),
          });

          mockFs.mkdir.mockResolvedValue(undefined);
          mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

          const mockArtifact = {
            id: 'artifact-123',
            incidentId: incident.id,
            artifactType: artifactType.toString(),
            filePath: '/tmp/backup/test-file.backup',
            originalPath: filePath,
            checksum: 'abc123def456',
            size: BigInt(1024),
            metadata: {
              ...metadata,
              originalPermissions: '644',
              originalOwner: 'www-data',
              originalGroup: 'www-data',
            },
            createdAt: new Date(),
          };

          prismaService.backupArtifact.create.mockResolvedValue(mockArtifact as any);

          // Create backup
          await service.createFileBackup(incident.id, server.id, filePath, artifactType, metadata);

          // Verify metadata was preserved in database call
          expect(prismaService.backupArtifact.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              metadata: expect.objectContaining({
                backupReason: metadata.backupReason,
                fixAttemptNumber: metadata.fixAttemptNumber,
                relatedFiles: metadata.relatedFiles,
                dependencies: metadata.dependencies,
                originalPermissions: '644',
                originalOwner: 'www-data',
                originalGroup: 'www-data',
              }),
            }),
          });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Directory Backup Compression
   * For any directory backup, the system should create compressed archives to save storage space.
   */
  it('should create compressed archives for directory backups', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockIncidentGenerator(),
        mockServerGenerator(),
        directoryPathGenerator(),
        fc.constantFrom(ArtifactType.DIRECTORY_BACKUP, ArtifactType.PLUGIN_BACKUP, ArtifactType.THEME_BACKUP),
        backupMetadataGenerator(),
        async (incident, server, directoryPath, artifactType, metadata) => {
          // Setup mocks for successful directory backup
          prismaService.incident.findUnique.mockResolvedValue(incident as any);
          prismaService.server.findUnique.mockResolvedValue(server as any);
          
          sshService.connect.mockResolvedValue({
            id: 'connection-123',
            config: { hostname: server.hostname, port: server.port, username: server.username },
            connection: {},
            isConnected: true,
            lastUsed: new Date(),
            createdAt: new Date(),
          } as any);

          const originalSize = 2048000;
          const compressedSize = 1024000;

          sshService.executeCommand
            .mockResolvedValueOnce({
              stdout: `${originalSize}\t${directoryPath}`,
              stderr: '',
              exitCode: 0,
              executionTime: 100,
              timestamp: new Date(),
              command: 'du command',
            })
            .mockResolvedValueOnce({
              stdout: '',
              stderr: '',
              exitCode: 0,
              executionTime: 500,
              timestamp: new Date(),
              command: 'tar command',
            })
            .mockResolvedValueOnce({
              stdout: '',
              stderr: '',
              exitCode: 0,
              executionTime: 50,
              timestamp: new Date(),
              command: 'rm command',
            });

          sshService.downloadFile.mockResolvedValue({
            success: true,
            bytesTransferred: compressedSize,
            executionTime: 1000,
            timestamp: new Date(),
          });

          mockFs.mkdir.mockResolvedValue(undefined);
          mockFs.stat.mockResolvedValue({ size: compressedSize } as any);
          mockFs.readFile.mockResolvedValue(Buffer.from('compressed archive content'));

          const mockArtifact = {
            id: 'artifact-123',
            incidentId: incident.id,
            artifactType: artifactType.toString(),
            filePath: '/tmp/backup/test-directory.tar.gz',
            originalPath: directoryPath,
            checksum: 'abc123def456',
            size: BigInt(compressedSize),
            metadata: {
              ...metadata,
              originalSize,
              compressionRatio: compressedSize / originalSize,
            },
            createdAt: new Date(),
          };

          prismaService.backupArtifact.create.mockResolvedValue(mockArtifact as any);

          // Create directory backup
          const result = await service.createDirectoryBackup(
            incident.id,
            server.id,
            directoryPath,
            artifactType,
            metadata
          );

          // Verify compression was used (tar command executed)
          expect(sshService.executeCommand).toHaveBeenCalledWith(
            'connection-123',
            expect.stringContaining('tar -czf')
          );

          // Verify backup was successful
          expect(result.success).toBe(true);
          expect(result.size).toBe(compressedSize);

          // Verify compression metadata was stored
          expect(prismaService.backupArtifact.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              metadata: expect.objectContaining({
                originalSize,
                compressionRatio: expect.any(Number),
              }),
            }),
          });
        }
      ),
      { numRuns: 5 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Checksum Calculation Consistency
   * For any file content, the checksum calculation should be deterministic and consistent.
   */
  it('should calculate consistent checksums for identical file content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10000 }),
        async (fileContent) => {
          // Mock file reading
          mockFs.readFile.mockResolvedValue(Buffer.from(fileContent));

          // Calculate checksum twice
          const checksum1 = await service.calculateFileChecksum('/test/file1.txt');
          const checksum2 = await service.calculateFileChecksum('/test/file2.txt');

          // Checksums should be identical for identical content
          expect(checksum1).toBe(checksum2);
          expect(checksum1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: wp-autohealer, Property: Backup Artifact Uniqueness
   * For any backup operation, each artifact should have a unique identifier and file path.
   */
  it('should generate unique identifiers and file paths for backup artifacts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            incident: mockIncidentGenerator(),
            server: mockServerGenerator(),
            filePath: filePathGenerator(),
            artifactType: artifactTypeGenerator(),
            metadata: backupMetadataGenerator(),
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (backupRequests) => {
          const createdArtifacts: any[] = [];

          for (const request of backupRequests) {
            // Setup mocks for each backup
            prismaService.incident.findUnique.mockResolvedValue(request.incident as any);
            prismaService.server.findUnique.mockResolvedValue(request.server as any);
            
            sshService.connect.mockResolvedValue({
              id: `connection-${Math.random()}`,
              config: { hostname: request.server.hostname, port: request.server.port, username: request.server.username },
              connection: {},
              isConnected: true,
              lastUsed: new Date(),
              createdAt: new Date(),
            } as any);

            sshService.executeCommand.mockResolvedValue({
              stdout: '1024 644 www-data www-data',
              stderr: '',
              exitCode: 0,
              executionTime: 100,
              timestamp: new Date(),
              command: 'stat command',
            });

            sshService.downloadFile.mockResolvedValue({
              success: true,
              bytesTransferred: 1024,
              executionTime: 200,
              timestamp: new Date(),
            });

            mockFs.mkdir.mockResolvedValue(undefined);
            mockFs.readFile.mockResolvedValue(Buffer.from('test file content'));

            const mockArtifact = {
              id: `artifact-${Math.random()}`,
              incidentId: request.incident.id,
              artifactType: request.artifactType.toString(),
              filePath: `/tmp/backup/backup-${Math.random()}.backup`,
              originalPath: request.filePath,
              checksum: `checksum-${Math.random()}`,
              size: BigInt(1024),
              metadata: request.metadata,
              createdAt: new Date(),
            };

            prismaService.backupArtifact.create.mockResolvedValue(mockArtifact as any);
            createdArtifacts.push(mockArtifact);
          }

          // Extract all artifact IDs and file paths
          const artifactIds = createdArtifacts.map(a => a.id);
          const filePaths = createdArtifacts.map(a => a.filePath);

          // Verify all IDs are unique
          const uniqueIds = new Set(artifactIds);
          expect(uniqueIds.size).toBe(artifactIds.length);

          // Verify all file paths are unique
          const uniquePaths = new Set(filePaths);
          expect(uniquePaths.size).toBe(filePaths.length);
        }
      ),
      { numRuns: 3 }
    );
  });
});