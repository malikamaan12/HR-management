import { db } from "../db";
import { onboardingChecklists, checklistTasks } from "@shared/schema";

export async function seedOnboardingData() {
  try {
    console.log("🌱 Seeding onboarding data...");
    
    // Create default onboarding checklists
    const standardChecklist = await db
      .insert(onboardingChecklists)
      .values({
        name: "Standard Employee Onboarding",
        description: "Standard onboarding process for all new employees",
        departmentSpecific: null,
        employeeTypeSpecific: "permanent"
      })
      .returning({ id: onboardingChecklists.id });

    const managerChecklist = await db
      .insert(onboardingChecklists)
      .values({
        name: "Manager Onboarding",
        description: "Additional onboarding steps for new managers",
        departmentSpecific: null,
        employeeTypeSpecific: "permanent"
      })
      .returning({ id: onboardingChecklists.id });

    const itChecklist = await db
      .insert(onboardingChecklists)
      .values({
        name: "IT Department Onboarding",
        description: "Specialized onboarding for IT department employees",
        departmentSpecific: "IT",
        employeeTypeSpecific: "permanent"
      })
      .returning({ id: onboardingChecklists.id });

    // Standard checklist tasks
    const standardTasks = [
      {
        checklistId: standardChecklist[0].id,
        taskName: "Send Welcome Email",
        description: "Send welcome email with first day information",
        category: "pre-joining",
        assignedTo: "hr",
        daysFromStart: -3,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Prepare Workspace",
        description: "Set up desk, chair, and basic office supplies",
        category: "pre-joining",
        assignedTo: "admin",
        daysFromStart: -1,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Create IT Accounts",
        description: "Create email account, system access, and security credentials",
        category: "pre-joining",
        assignedTo: "it",
        daysFromStart: -2,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Office Tour",
        description: "Give new employee a tour of the office facilities",
        category: "first_day",
        assignedTo: "hr",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Complete Paperwork",
        description: "Fill out employment forms, tax documents, and emergency contacts",
        category: "first_day",
        assignedTo: "new_hire",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Meet the Team",
        description: "Introduce new employee to immediate team members",
        category: "first_day",
        assignedTo: "manager",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "IT Equipment Setup",
        description: "Set up computer, phone, and other necessary technology",
        category: "first_day",
        assignedTo: "it",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Safety Training",
        description: "Complete mandatory safety and security training",
        category: "first_week",
        assignedTo: "new_hire",
        daysFromStart: 2,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Role Expectations Meeting",
        description: "Discuss role expectations, goals, and performance metrics",
        category: "first_week",
        assignedTo: "manager",
        daysFromStart: 3,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Complete Compliance Training",
        description: "Complete required compliance and policy training modules",
        category: "first_week",
        assignedTo: "new_hire",
        daysFromStart: 5,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "30-Day Check-in Meeting",
        description: "Formal check-in to discuss progress and address any concerns",
        category: "first_month",
        assignedTo: "manager",
        daysFromStart: 30,
        isRequired: true
      },
      {
        checklistId: standardChecklist[0].id,
        taskName: "Benefits Enrollment",
        description: "Complete health insurance and benefits enrollment",
        category: "first_month",
        assignedTo: "hr",
        daysFromStart: 15,
        isRequired: true
      }
    ];

    // Manager checklist tasks (in addition to standard)
    const managerTasks = [
      {
        checklistId: managerChecklist[0].id,
        taskName: "Leadership Training Overview",
        description: "Introduction to company leadership principles and management tools",
        category: "first_week",
        assignedTo: "hr",
        daysFromStart: 3,
        isRequired: true
      },
      {
        checklistId: managerChecklist[0].id,
        taskName: "Budget and Finance Training",
        description: "Training on budget management and financial reporting",
        category: "first_week",
        assignedTo: "finance",
        daysFromStart: 5,
        isRequired: true
      },
      {
        checklistId: managerChecklist[0].id,
        taskName: "Team Introduction Sessions",
        description: "Individual meetings with each direct report",
        category: "first_week",
        assignedTo: "new_hire",
        daysFromStart: 4,
        isRequired: true
      },
      {
        checklistId: managerChecklist[0].id,
        taskName: "HR Policies for Managers",
        description: "Training on hiring, performance management, and disciplinary procedures",
        category: "first_month",
        assignedTo: "hr",
        daysFromStart: 10,
        isRequired: true
      },
      {
        checklistId: managerChecklist[0].id,
        taskName: "Strategic Planning Session",
        description: "Review department goals and strategic objectives",
        category: "first_month",
        assignedTo: "manager",
        daysFromStart: 20,
        isRequired: true
      }
    ];

    // IT department tasks
    const itTasks = [
      {
        checklistId: itChecklist[0].id,
        taskName: "Security Clearance Verification",
        description: "Verify and process security clearance documentation",
        category: "pre-joining",
        assignedTo: "hr",
        daysFromStart: -5,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "Advanced System Access",
        description: "Set up access to development systems, databases, and specialized tools",
        category: "first_day",
        assignedTo: "it",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "Code Repository Access",
        description: "Grant access to version control systems and code repositories",
        category: "first_day",
        assignedTo: "it",
        daysFromStart: 0,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "Technical Documentation Review",
        description: "Review system architecture, coding standards, and technical processes",
        category: "first_week",
        assignedTo: "new_hire",
        daysFromStart: 2,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "Mentor Assignment",
        description: "Assign a senior developer as mentor for the first month",
        category: "first_week",
        assignedTo: "manager",
        daysFromStart: 1,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "Security Training - Advanced",
        description: "Complete advanced cybersecurity training for IT personnel",
        category: "first_week",
        assignedTo: "new_hire",
        daysFromStart: 5,
        isRequired: true
      },
      {
        checklistId: itChecklist[0].id,
        taskName: "First Project Assignment",
        description: "Assign initial project or tasks appropriate for new team member",
        category: "first_week",
        assignedTo: "manager",
        daysFromStart: 7,
        isRequired: false
      }
    ];

    // Insert all tasks
    await db.insert(checklistTasks).values([
      ...standardTasks,
      ...managerTasks,
      ...itTasks
    ]);

    console.log("✅ Onboarding data seeded successfully");
    console.log(`Created ${standardTasks.length} standard tasks, ${managerTasks.length} manager tasks, ${itTasks.length} IT tasks`);
    
  } catch (error) {
    console.error("❌ Error seeding onboarding data:", error);
    throw error;
  }
}