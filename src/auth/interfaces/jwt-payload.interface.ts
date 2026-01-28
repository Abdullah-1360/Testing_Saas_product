export interface JwtPayload {
  sub: string; // user id
  email: string;
  username: string;
  roleId: string;
  roleName: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  sessionId: string;
  tokenType: 'refresh';
  iat?: number;
  exp?: number;
}