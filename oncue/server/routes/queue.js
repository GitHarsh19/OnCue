import { Router } from "express";
import {
  snapshot,
  manualUpdate,
  customerDone,
  updateSettings,
  addWaiting,
  startService,
  resetDay,
  clearQueue,
} from "../store/queueStore.js";

export default function makeQueueRouter(broadcast) {
  const router = Router();

  function send(salonId, res) {
    const snap = snapshot(salonId);
    broadcast(salonId, snap);
    res.json(snap);
  }

  router.get("/queue/:salonId", (req, res) => {
    res.json(snapshot(req.params.salonId));
  });

  router.post("/queue/:salonId/settings", (req, res) => {
    updateSettings(req.params.salonId, req.body || {});
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/manual", (req, res) => {
    manualUpdate(req.params.salonId, req.body || {});
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/customer-done", (req, res) => {
    customerDone(req.params.salonId);
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/add-waiting", (req, res) => {
    const n = Number(req.body?.n ?? 1);
    addWaiting(req.params.salonId, Number.isFinite(n) ? n : 1);
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/remove-waiting", (req, res) => {
    addWaiting(req.params.salonId, -1);
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/start-service", (req, res) => {
    startService(req.params.salonId);
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/reset-day", (req, res) => {
    resetDay(req.params.salonId);
    send(req.params.salonId, res);
  });

  router.post("/queue/:salonId/clear", (req, res) => {
    clearQueue(req.params.salonId);
    send(req.params.salonId, res);
  });

  return router;
}
