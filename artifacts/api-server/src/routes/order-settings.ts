import { Router, type IRouter } from "express";
import { getStore, updateStore } from "../data/store.js";
import type { OrderSettings } from "../data/store.js";
import { isAdminAuthenticated } from "./admin.js";

const router: IRouter = Router();

function publicSettings(settings: OrderSettings) {
  const { telegramBotToken, telegramChatId, ...safe } = settings;
  return safe;
}


router.get("/order-settings", (_req, res) => {
  res.json(publicSettings(getStore().orderSettings));
});

router.get("/admin/order-settings", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.json(getStore().orderSettings);
});

router.put("/admin/order-settings", (req, res) => {
  if (!isAdminAuthenticated(req as Parameters<typeof isAdminAuthenticated>[0])) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const body = req.body as Partial<OrderSettings>;
  let saved: OrderSettings;

  updateStore((store) => {
    store.orderSettings = {
      ...store.orderSettings,
      shippingCompanyName: body.shippingCompanyName ?? store.orderSettings.shippingCompanyName,
      shippingDescription: body.shippingDescription ?? store.orderSettings.shippingDescription,
      shippingPrice: Number(body.shippingPrice ?? store.orderSettings.shippingPrice),
      frontOnlyPrice: Number(body.frontOnlyPrice ?? store.orderSettings.frontOnlyPrice),
      frontBackPrice: Number(body.frontBackPrice ?? store.orderSettings.frontBackPrice),
      instaPayPhone: body.instaPayPhone ?? store.orderSettings.instaPayPhone,
      telegramChatId: body.telegramChatId ?? store.orderSettings.telegramChatId,
      telegramBotToken: body.telegramBotToken ?? store.orderSettings.telegramBotToken,
      showExportButton: body.showExportButton !== undefined ? body.showExportButton : store.orderSettings.showExportButton,
    };
    saved = store.orderSettings;
  });

  res.json(saved!);
});

export default router;