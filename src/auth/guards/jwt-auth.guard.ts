import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    console.log('[JWT Guard] canActivate - Authorization header:', authHeader ? `Bearer ${authHeader.substring(7, 27)}...` : 'MISSING');

    return super.canActivate(context);
  }

  override handleRequest(err: any, user: any, info: any, _context: ExecutionContext) {
    console.log('[JWT Guard] handleRequest - err:', err?.message, 'user:', user ? `${user.id}` : 'NO_USER', 'info:', info?.message || info);
    if (err || !user) {
      throw err || new UnauthorizedException('Authentication required');
    }
    return user;
  }
}