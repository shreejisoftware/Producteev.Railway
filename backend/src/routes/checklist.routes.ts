import { Router } from 'express';
import { ChecklistController } from '../controllers/checklist.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Checklist routes
router.post('/task/:taskId', ChecklistController.create);
router.patch('/:id', ChecklistController.update);
router.delete('/:id', ChecklistController.delete);

// Checklist Item routes
router.post('/:id/items', ChecklistController.addItem);
router.patch('/items/:itemId', ChecklistController.updateItem);
router.delete('/items/:itemId', ChecklistController.deleteItem);

export default router;
