import { Router } from 'express';
import { RewardController, StakeController, WalletController } from '../controllers/wallet.controller';
import { authenticate } from '../middleware/authenticate';
import { requireAuth } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import { idParam, stakeListQuery, transactionQuery } from '../validators/schemas';

export const walletRouter = Router();

walletRouter.use(authenticate, requireAuth());

walletRouter.get('/', WalletController.get);
walletRouter.get('/transactions', validate({ query: transactionQuery }), WalletController.transactions);
walletRouter.get('/insights', WalletController.insights);

export const stakeRouter = Router();
stakeRouter.use(authenticate, requireAuth());
stakeRouter.get('/', validate({ query: stakeListQuery }), StakeController.list);
stakeRouter.get('/summary', StakeController.summary);
stakeRouter.get('/:id', validate({ params: idParam }), StakeController.detail);

export const rewardRouter = Router();
rewardRouter.use(authenticate, requireAuth());
rewardRouter.get('/', RewardController.list);
rewardRouter.get('/pool', RewardController.pool);
