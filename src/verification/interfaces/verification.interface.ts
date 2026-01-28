export interface VerificationResult {
  success: boolean;
  verificationType: string;
  details: Record<string, any>;
  issues: string[];
  timestamp: Date;
  responseTime?: number;
}

export interface HttpCheckResult {
  success: boolean;
  statusCode?: number;
  content?: string;
  responseTime: number;
  error?: string;
}

export interface WordPressLoginResult {
  accessible: boolean;
  loginFormPresent: boolean;
  responseTime: number;
  error?: string;
}

export interface InternalUrlResult {
  url: string;
  accessible: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
}

export interface ComprehensiveVerificationResult {
  overall: {
    success: boolean;
    healthy: boolean;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    responseTime: number;
  };
  httpStatus: VerificationResult;
  fatalErrorCheck: VerificationResult;
  maintenanceCheck: VerificationResult;
  whiteScreenCheck: VerificationResult;
  titleTagCheck: VerificationResult;
  canonicalTagCheck: VerificationResult;
  footerMarkerCheck: VerificationResult;
  headerMarkerCheck: VerificationResult;
  wpLoginCheck: VerificationResult;
  internalUrlCheck: VerificationResult;
  timestamp: Date;
}