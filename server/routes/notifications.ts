import express from "express";
import { z } from "zod";
import notificationService from "../services/notifications";
import { insertNotificationSchema } from "@shared/schema";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

// Get notifications for the current user
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const notifications = await notificationService.getUserNotifications(userId);
    return res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Mark a notification as read
router.patch("/:id/mark-delivered", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const notificationId = parseInt(req.params.id);
    
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: "Invalid notification ID" });
    }

    const success = await notificationService.markNotificationDelivered(notificationId,userId);
    
    if (!success) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Error marking notification as delivered:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new notification
router.post("/", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const userId = req.user!.userId;
    
    const schema = insertNotificationSchema;
    const validationResult = schema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid notification data", 
        details: validationResult.error.format() 
      });
    }

    const notification = await notificationService.createNotification(validationResult.data);
    return res.status(201).json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;