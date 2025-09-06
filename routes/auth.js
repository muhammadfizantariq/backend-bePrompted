import { Router } from 'express';
import { register, login, me, verifyEmail, resendVerification, forgotPassword, resetPassword, googleAuth } from '../controllers/authController.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();


router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/google', googleAuth);
router.get('/me', authRequired, me);

export default router;
