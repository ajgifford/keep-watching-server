import { AccountIdParam, AccountParams, GoogleLoginParams, LoginParam } from '../schema/accountSchema';
import { authenticationService } from '../services/authenticationService';
import { getAccountImage, getPhotoForGoogleAccount } from '../utils/imageUtility';
import { NextFunction, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';

/**
 * Authentication Controller
 *
 * This controller handles user authentication operations including:
 * - Registration of new accounts
 * - Login with existing accounts
 * - Google OAuth authentication
 * - User logout
 */

/**
 * Register a new account
 *
 * Creates a new user account with the provided details
 *
 * @route POST /api/v1/authentication/register
 * @param {Request} req - Express request containing name, email, and uid in body
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express next function
 * @returns {Response} 201 with new account details on success
 */
export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, uid }: AccountParams = req.body;
    const account = await authenticationService.register(name, email, uid);

    res.status(201).json({
      message: 'Account registered successfully',
      result: {
        id: account.account_id,
        name: account.account_name,
        uid: account.uid,
        email: account.email,
        image: getAccountImage(account),
        default_profile_id: account.default_profile_id,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Login with existing account
 *
 * Authenticates a user with their Firebase UID
 *
 * @route POST /api/v1/authentication/login
 * @param {Request} req - Express request containing uid in body
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express next function
 * @returns {Response} 200 with account details on success
 */
export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uid }: LoginParam = req.body;
    const account = await authenticationService.login(uid);

    res.status(200).json({
      message: 'Login successful',
      result: {
        id: account.account_id,
        name: account.account_name,
        uid: account.uid,
        email: account.email,
        image: getAccountImage(account),
        default_profile_id: account.default_profile_id,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Login or register with Google
 *
 * Authenticates a user with Google credentials, creating a new account if needed
 *
 * @route POST /api/v1/authentication/googleLogin
 * @param {Request} req - Express request containing name, email, uid, and optional photoURL in body
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express next function
 * @returns {Response} 201 for new accounts, 200 for existing accounts
 */
export const googleLogin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, uid, photoURL }: GoogleLoginParams = req.body;
    const googleLoginResult = await authenticationService.googleLogin(name, email, uid);

    const statusCode = googleLoginResult.isNewAccount ? 201 : 200;
    const message = googleLoginResult.isNewAccount ? 'Account registered successfully' : 'Login successful';

    res.status(statusCode).json({
      message: message,
      result: {
        id: googleLoginResult.account.account_id,
        name: googleLoginResult.account.account_name,
        uid: googleLoginResult.account.uid,
        email: googleLoginResult.account.email,
        image: getPhotoForGoogleAccount(name, photoURL, googleLoginResult.account),
        default_profile_id: googleLoginResult.account.default_profile_id,
        isNewAccount: googleLoginResult.isNewAccount,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Logout user
 *
 * Logs out the user by invalidating their cache data
 *
 * @route POST /api/v1/authentication/logout
 * @param {Request} req - Express request containing accountId in body
 * @param {Response} res - Express response
 * @param {NextFunction} next - Express next function
 * @returns {Response} 200 with success message
 */
export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accountId }: AccountIdParam = req.body;
    authenticationService.logout(accountId);
    res.status(200).json({ message: 'Account logged out' });
  } catch (error) {
    next(error);
  }
});
