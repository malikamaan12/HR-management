import express from "express";
import { z } from "zod";
import announcementService from "../services/announcements";
import { insertAnnouncementSchema, announcements } from "@shared/schema";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

// Get all active announcements
router.get("/", authenticate, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const announcements = await announcementService.getActiveAnnouncements(limit,req.user!);
    
    return res.json(announcements);
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get department announcements
router.get("/department/:department", authenticate, async (req, res) => {
  try {
    const department = req.params.department;
    if(department !== req.user!.department && !['admin','super_admin','hr'].includes(req.user!.role))return res.status(403).json({error:'Department access denied'});

    if (!department) {
      return res.status(400).json({ error: "Department is required" });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const announcements = await announcementService.getDepartmentAnnouncements(department, limit);
    
    return res.json(announcements);
  } catch (error) {
    console.error("Error fetching department announcements:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new announcement
router.post("/", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const userId = req.user!.userId;
    
    // Set the author ID to the current user
    const announcementData = {
      ...req.body,
      authorId: userId
    };

    const schema = insertAnnouncementSchema;
    const validationResult = schema.safeParse(announcementData);

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid announcement data", 
        details: validationResult.error.format() 
      });
    }

    const announcement = await announcementService.createAnnouncement(validationResult.data);
    return res.status(201).json(announcement);
  } catch (error) {
    console.error("Error creating announcement:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle pin status of an announcement
router.patch("/:id/toggle-pin", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const announcementId = parseInt(req.params.id);

    if (isNaN(announcementId)) {
      return res.status(400).json({ error: "Invalid announcement ID" });
    }

    // Toggle pin status
    const [updatedAnnouncement] = await db.update(announcements)
      .set({
        isPinned: sql`NOT ${announcements.isPinned}`,
        updatedAt: new Date()
      })
      .where(eq(announcements.id, announcementId))
      .returning();

    if (!updatedAnnouncement) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    return res.json(updatedAnnouncement);
  } catch (error) {
    console.error("Error toggling announcement pin status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Deactivate an announcement
router.patch("/:id/deactivate", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const announcementId = parseInt(req.params.id);

    if (isNaN(announcementId)) {
      return res.status(400).json({ error: "Invalid announcement ID" });
    }

    // Deactivate the announcement
    const [updatedAnnouncement] = await db.update(announcements)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(announcements.id, announcementId))
      .returning();

    if (!updatedAnnouncement) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    return res.json(updatedAnnouncement);
  } catch (error) {
    console.error("Error deactivating announcement:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;