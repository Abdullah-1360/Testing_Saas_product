import { Module } from '@nestjs/common';
import { WordPressFixesService } from './wordpress-fixes.service';
import { WordPressFixesController } from './wordpress-fixes.controller';
import { Tier1InfrastructureService } from './tiers/tier1-infrastructure.service';
import { Tier2CoreIntegrityService } from './tiers/tier2-core-integrity.service';
import { Tier3PluginThemeConflictsService } from './tiers/tier3-plugin-theme-conflicts.service';
import { DiskSpaceCleanupService } from './playbooks/disk-space-cleanup.service';
import { MemoryLimitAdjustmentService } from './playbooks/memory-limit-adjustment.service';
import { PhpErrorLogAnalysisService } from './playbooks/php-error-log-analysis.service';
import { WebServerConfigFixesService } from './playbooks/web-server-config-fixes.service';
import { DatabaseConnectionRestorationService } from './playbooks/database-connection-restoration.service';
import { WordPressCoreIntegrityService } from './playbooks/wordpress-core-integrity.service';
import { WpConfigValidationService } from './playbooks/wp-config-validation.service';
import { DatabaseTableRepairService } from './playbooks/database-table-repair.service';
import { PluginConflictDetectionService } from './playbooks/plugin-conflict-detection.service';
import { ThemeSwitchingService } from './playbooks/theme-switching.service';
import { PluginDeactivationService } from './playbooks/plugin-deactivation.service';
import { ThemeRollbackService } from './playbooks/theme-rollback.service';
import { FixPlaybookRegistry } from './fix-playbook-registry.service';
import { SshModule } from '@/ssh/ssh.module';
import { ServersModule } from '@/servers/servers.module';
import { SitesModule } from '@/sites/sites.module';
import { BackupModule } from '@/backup/backup.module';
import { EvidenceModule } from '@/evidence/evidence.module';
import { VerificationModule } from '@/verification/verification.module';

@Module({
  imports: [
    SshModule,
    ServersModule,
    SitesModule,
    BackupModule,
    EvidenceModule,
    VerificationModule,
  ],
  controllers: [WordPressFixesController],
  providers: [
    WordPressFixesService,
    FixPlaybookRegistry,
    
    // Tier 1 Infrastructure Services
    Tier1InfrastructureService,
    DiskSpaceCleanupService,
    MemoryLimitAdjustmentService,
    PhpErrorLogAnalysisService,
    WebServerConfigFixesService,
    DatabaseConnectionRestorationService,
    
    // Tier 2 Core Integrity Services
    Tier2CoreIntegrityService,
    WordPressCoreIntegrityService,
    WpConfigValidationService,
    DatabaseTableRepairService,
    
    // Tier 3 Plugin/Theme Conflicts Services
    Tier3PluginThemeConflictsService,
    PluginConflictDetectionService,
    ThemeSwitchingService,
    PluginDeactivationService,
    ThemeRollbackService,
  ],
  exports: [
    WordPressFixesService,
    FixPlaybookRegistry,
    Tier1InfrastructureService,
    Tier2CoreIntegrityService,
    Tier3PluginThemeConflictsService,
  ],
})
export class WordPressFixesModule {}