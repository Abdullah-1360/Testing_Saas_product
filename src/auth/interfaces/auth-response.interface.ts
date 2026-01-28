export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: any; // Using any to avoid complex type issues
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  sessionId?: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}

export interface MfaSetupResponse {
  secret: string;
  qrCode: string;
  backupCodes: string[];
}

export interface PasswordResetResponse {
  message: string;
  success: boolean;
}