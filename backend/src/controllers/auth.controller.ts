import type { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { authContext } from '../middleware/authorize';
import { asyncHandler } from '../utils/http';

export const AuthController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await AuthService.register(req.body);
    res.status(201).json({ data: result });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await AuthService.login(req.body);
    res.status(200).json({ data: result });
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    await AuthService.logout(token);
    res.status(200).json({ data: { success: true } });
  }),

  profile: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const user = await AuthService.getProfile(userId);
    res.status(200).json({ data: user });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    const user = await AuthService.updateProfile(userId, req.body);
    res.status(200).json({ data: user });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = authContext(req);
    await AuthService.changePassword(userId, req.body.currentPassword, req.body.newPassword);
    res.status(200).json({ data: { success: true } });
  }),
};
