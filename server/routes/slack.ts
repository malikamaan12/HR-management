import express from "express";
import { z } from "zod";
import slackService from "../services/slack";
import { db } from "../db";
import { slackIntegration, insertSlackIntegrationSchema, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticate, authorize } from "../middleware/auth";

const router = express.Router();

// Check Slack connection status
router.get("/status", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const isConnected = await slackService.checkSlackConnection();
    
    return res.json({ 
      connected: isConnected,
      botToken: process.env.SLACK_BOT_TOKEN ? true : false,
      channelId: process.env.SLACK_CHANNEL_ID ? true : false
    });
  } catch (error) {
    console.error("Error checking Slack connection:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's Slack integration status
router.get("/user-integration", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Get user's Slack integration
    const [integration] = await db.select()
      .from(slackIntegration)
      .where(eq(slackIntegration.userId, userId));
    
    if (!integration) {
      return res.json({ integrated: false });
    }
    
    return res.json({
      integrated: true,
      slackUsername: integration.slackUsername,
      slackEmail: integration.slackEmail,
      isActive: integration.isActive,
      lastSynced: integration.lastSynced
    });
  } catch (error) {
    console.error("Error fetching Slack integration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Connect user to Slack
router.post("/connect-user", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    
    const schema = z.object({
      email: z.string().email()
    });

    const validationResult = schema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid data", 
        details: validationResult.error.format() 
      });
    }

    const { email } = validationResult.data;

    // Find user in Slack by email
    const slackUser = await slackService.findSlackUserByEmail(email);

    if (!slackUser) {
      return res.status(404).json({ error: "Slack user not found with this email" });
    }

    // Check if user already has a Slack integration
    const existingIntegration = await db.select()
      .from(slackIntegration)
      .where(eq(slackIntegration.userId, userId));

    // Delete existing integration if it exists
    if (existingIntegration.length > 0) {
      await db.delete(slackIntegration)
        .where(eq(slackIntegration.userId, userId));
    }

    // Create new integration
    const [integration] = await db.insert(slackIntegration)
      .values({
        userId: userId,
        slackUserId: slackUser.id,
        slackEmail: email,
        slackUsername: slackUser.name,
        isActive: true,
        lastSynced: new Date()
      })
      .returning();

    return res.status(201).json(integration);
  } catch (error) {
    console.error("Error connecting user to Slack:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Test send a message to Slack
router.post("/test-message", authenticate, authorize(["admin", "hr"]), async (req, res) => {
  try {
    const userId = req.user!.userId;
    
    const schema = z.object({
      message: z.string().min(1).max(1000)
    });

    const validationResult = schema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid message", 
        details: validationResult.error.format() 
      });
    }

    // Get user info for the message
    const [user] = await db.select({
      firstName: users.firstName,
      lastName: users.lastName
    })
    .from(users)
    .where(eq(users.id, userId));

    const { message } = validationResult.data;
    const senderName = user ? `${user.firstName} ${user.lastName}` : "Unknown User";

    // Send test message
    const testMessage = `*Test Message from E3 HR System*\n\n${message}\n\n_Sent by: ${senderName}_`;
    const result = await slackService.sendSlackMessage(testMessage);

    if (!result) {
      return res.status(500).json({ error: "Failed to send message" });
    }

    return res.json({ success: true, message: "Test message sent successfully" });
  } catch (error) {
    console.error("Error sending test message to Slack:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;