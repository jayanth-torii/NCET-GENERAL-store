import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { authRoutes } from '../routes/auth/route';
import { AuthGuard } from '../middleware/auth.guard';
import { AuthService } from '../services/auth/service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET ?? '';
        if (secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters in backend/.env');
        return { secret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } };
      },
    }),
  ],
  controllers: authRoutes,
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
