import { WebClient, type ChatPostMessageArguments } from "@slack/web-api";

// Check if Slack credentials are available
if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable is not set. Slack integration will not work.");
}

if (!process.env.SLACK_CHANNEL_ID) {
  console.warn("SLACK_CHANNEL_ID environment variable is not set. Slack integration will use default channel.");
}

// Initialize the Slack Web Client with the bot token
const slackClient = process.env.SLACK_BOT_TOKEN 
  ? new WebClient(process.env.SLACK_BOT_TOKEN)
  : null;

const defaultChannelId = process.env.SLACK_CHANNEL_ID || "";

/**
 * Sends a message to a Slack channel
 * @param message The message to send
 * @param channelId Optional channel ID (defaults to SLACK_CHANNEL_ID environment variable)
 * @returns The timestamp of the sent message or undefined if failed
 */
export async function sendSlackMessage(
  message: string | ChatPostMessageArguments,
  channelId: string = defaultChannelId
): Promise<string | undefined> {
  if (!slackClient) {
    console.error("Slack client not initialized. Cannot send message.");
    return undefined;
  }
  
  try {
    // If message is a string, convert it to a ChatPostMessageArguments object
    const messageArgs: ChatPostMessageArguments = typeof message === 'string'
      ? { channel: channelId, text: message }
      : { ...message, channel: message.channel || channelId };
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageArgs);
    
    console.log(`Message sent to Slack successfully (${response.ts})`);
    return response.ts;
  } catch (error) {
    console.error('Error sending Slack message:', error);
    return undefined;
  }
}

/**
 * Sends a notification to a Slack channel with formatted content
 * @param title The title of the notification
 * @param content The content of the notification
 * @param importance The importance level (info, warning, error)
 * @param channelId Optional channel ID
 * @returns The timestamp of the sent message or undefined if failed
 */
export async function sendNotification(
  title: string,
  content: string,
  importance: 'info' | 'warning' | 'error' = 'info',
  channelId: string = defaultChannelId
): Promise<string | undefined> {
  if (!slackClient) {
    console.error("Slack client not initialized. Cannot send notification.");
    return undefined;
  }
  
  // Determine color based on importance
  let color = '#2196F3'; // Blue for info
  if (importance === 'warning') color = '#FF9800'; // Orange for warning
  if (importance === 'error') color = '#F44336'; // Red for error
  
  // Create a Block Kit formatted message
  const message: ChatPostMessageArguments = {
    channel: channelId,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: title,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Sent from:* E3 HR Management System | *Time:* ${new Date().toLocaleString()}`
          }
        ]
      }
    ],
    attachments: [
      {
        color: color
      }
    ]
  };
  
  return sendSlackMessage(message, channelId);
}

/**
 * Sends an announcement to a Slack channel
 * @param title The announcement title
 * @param content The announcement content
 * @param author The name of the author
 * @param channelId Optional channel ID
 * @returns The timestamp of the sent message or undefined if failed
 */
export async function sendAnnouncement(
  title: string,
  content: string,
  author: string,
  channelId: string = defaultChannelId
): Promise<string | undefined> {
  if (!slackClient) {
    console.error("Slack client not initialized. Cannot send announcement.");
    return undefined;
  }
  
  // Create a Block Kit formatted announcement
  const message: ChatPostMessageArguments = {
    channel: channelId,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📢 ${title}`,
          emoji: true
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Posted by:* ${author} | *Date:* ${new Date().toLocaleDateString()}`
          }
        ]
      }
    ],
    attachments: [
      {
        color: '#4CAF50' // Green for announcements
      }
    ]
  };
  
  return sendSlackMessage(message, channelId);
}

/**
 * Searches for a Slack user by their email
 * @param email The email address to search for
 * @returns The user information or null if not found
 */
export async function findSlackUserByEmail(email: string): Promise<any | null> {
  if (!slackClient) {
    console.error("Slack client not initialized. Cannot find user.");
    return null;
  }
  
  try {
    const response = await slackClient.users.lookupByEmail({
      email: email
    });
    
    if (response.ok && response.user) {
      return response.user;
    }
    
    return null;
  } catch (error) {
    console.error('Error finding Slack user by email:', error);
    return null;
  }
}

/**
 * Checks the connection status with Slack
 * @returns true if connected, false otherwise
 */
export async function checkSlackConnection(): Promise<boolean> {
  if (!slackClient) {
    return false;
  }
  
  try {
    const response = await slackClient.auth.test();
    return response.ok === true;
  } catch (error) {
    console.error('Error checking Slack connection:', error);
    return false;
  }
}

export default {
  sendSlackMessage,
  sendNotification,
  sendAnnouncement,
  findSlackUserByEmail,
  checkSlackConnection
};