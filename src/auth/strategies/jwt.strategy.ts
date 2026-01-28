import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../services/auth.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { User } from '@/users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    console.log('[JWT Strategy] Initializing with secret:', jwtSecret ? 'SECRET_SET' : 'NO_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    console.log('[JWT Strategy] Validating payload:', { sub: payload.sub, email: payload.email, roleName: payload.roleName });
    try {
      const user = await this.authService.validateJwtPayload(payload);
      console.log('[JWT Strategy] User validated successfully:', { id: user.id, email: user.email });
      return user;
    } catch (error) {
      console.error('[JWT Strategy] Validation failed:', error.message);
      throw new UnauthorizedException('Invalid token');
    }
  }
}