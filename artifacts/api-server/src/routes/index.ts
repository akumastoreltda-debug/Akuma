import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import suppliersRouter from "./suppliers";
import alertsRouter from "./alerts";
import amazonRouter from "./amazon";
import salesRouter from "./sales";
import inventoryRouter from "./inventory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(productsRouter);
router.use(suppliersRouter);
router.use(alertsRouter);
router.use(amazonRouter);
router.use(salesRouter);
router.use(inventoryRouter);

export default router;
