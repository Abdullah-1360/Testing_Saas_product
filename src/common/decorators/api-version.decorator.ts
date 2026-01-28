import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';

export const API_VERSION_KEY = 'api_version';
export const API_DEPRECATION_KEY = 'api_deprecation';

export interface ApiVersionConfig {
  version: string;
  deprecated?: boolean;
  deprecationDate?: Date;
  replacedBy?: string;
  description?: string;
}

/**
 * Decorator to mark API endpoints with version information
 */
export const ApiVersion = (config: ApiVersionConfig) => {
  const decorators = [
    SetMetadata(API_VERSION_KEY, config),
  ];

  if (config.deprecated) {
    decorators.push(
      SetMetadata(API_DEPRECATION_KEY, {
        deprecated: true,
        deprecationDate: config.deprecationDate,
        replacedBy: config.replacedBy,
      })
    );
  }

  return applyDecorators(...decorators);
};

/**
 * Decorator for versioned API controllers
 */
export const VersionedApiController = (
  path: string,
  version: string = '1',
  tag?: string
) => {
  return applyDecorators(
    ApiTags(tag || path),
    ApiVersion({ version }),
    ApiOperation({
      summary: `${path} API v${version}`,
      description: `Versioned API endpoints for ${path} management`,
    })
  );
};

/**
 * Decorator for deprecated API endpoints
 */
export const DeprecatedApi = (
  replacedBy?: string,
  deprecationDate?: Date
) => {
  return ApiVersion({
    version: '1',
    deprecated: true,
    deprecationDate,
    replacedBy,
  });
};