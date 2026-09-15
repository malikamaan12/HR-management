import express from 'express';
import { 
  analyzeSkillGapsByDepartment, 
  getEmployeeSkills, 
  recommendCourses, 
  getLMSCourses, 
  enrollUserInCourse, 
  getCourseProgress,
  getSkillGapRecommendations
} from '../services/skillGap';
import { authenticate, authorize } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { hasPermission } from '@shared/permissions';
import { employees } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';

const router = express.Router();

async function canAccessEmployee(req: any, employeeId: number, permission: 'read' | 'create' | 'update' = 'read') {
  if (!req.user || !hasPermission(req.user.role, 'training_development', permission)) return false;
  const [row] = await db.select({ id: employees.id }).from(employees)
    .where(and(eq(employees.id, employeeId), employeeScope(req.user, 'training_development', permission)));
  return !!row;
}

/**
 * @route GET /skills/gaps/:departmentId
 * @desc Analyze skill gaps within a department
 * @access Private (HR, Managers)
 */
router.get('/skills/gaps/:departmentId', authenticate, authorize(['admin', 'hr']), async (req, res) => {
  try {
    const departmentId = req.params.departmentId;
    
    if (!departmentId.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid department ID" 
      });
    }
    
    const result = await analyzeSkillGapsByDepartment(departmentId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error analyzing skill gaps:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while analyzing skill gaps", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route GET /skills/employee/:employeeId
 * @desc Get skills for a specific employee
 * @access Private (Employee can view own, HR/Managers can view all)
 */
router.get('/skills/employee/:employeeId', authenticate, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    
    if (isNaN(employeeId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid employee ID" 
      });
    }
    
    if (!(await canAccessEmployee(req, employeeId, 'read'))) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to view other employees' skills" 
      });
    }
    
    const result = await getEmployeeSkills(employeeId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error fetching employee skills:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while fetching employee skills", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route GET /training/recommend/:employeeId
 * @desc Recommend training courses for an employee based on skill gaps
 * @access Private (Employee can view own, HR/Managers can view all)
 */
router.get('/training/recommend/:employeeId', authenticate, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    
    if (isNaN(employeeId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid employee ID" 
      });
    }
    
    if (!(await canAccessEmployee(req, employeeId, 'read'))) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to view other employees' training recommendations" 
      });
    }
    
    const result = await recommendCourses(employeeId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error recommending courses:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while recommending courses", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route GET /training/courses
 * @desc Get all available training courses from LMS
 * @access Private
 */
router.get('/training/courses', authenticate, async (req, res) => {
  try {
    const result = await getLMSCourses();
    
    if (!result.success) {
      return res.status(502).json(result); // Bad Gateway - external service error
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error fetching LMS courses:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while fetching courses", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route POST /training/enroll
 * @desc Enroll a user in a training course
 * @access Private (Employee can enroll themselves, HR/Managers can enroll others)
 */
router.post('/training/enroll', authenticate, async (req, res) => {
  try {
    const { employeeId, courseId } = req.body;
    
    if (!employeeId || !courseId) {
      return res.status(400).json({ 
        success: false, 
        message: "Employee ID and course ID are required" 
      });
    }
    
    if (!(await canAccessEmployee(req, Number(employeeId), 'create'))) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to enroll other employees" 
      });
    }
    
    const result = await enrollUserInCourse(employeeId, courseId);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    return res.status(201).json(result);
  } catch (error) {
    console.error('Error enrolling in course:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while enrolling in course", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route GET /training/progress/:employeeId/:courseId
 * @desc Get an employee's progress in a specific course
 * @access Private (Employee can view own, HR/Managers can view all)
 */
router.get('/training/progress/:employeeId/:courseId', authenticate, async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const courseId = parseInt(req.params.courseId);
    
    if (isNaN(employeeId) || isNaN(courseId)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid employee ID or course ID" 
      });
    }
    
    if (!(await canAccessEmployee(req, employeeId, 'read'))) {
      return res.status(403).json({ 
        success: false, 
        message: "Not authorized to view other employees' course progress" 
      });
    }
    
    const result = await getCourseProgress(employeeId, courseId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error fetching course progress:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while fetching course progress", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * @route GET /training/recommendations/department/:departmentId
 * @desc Get training course recommendations for an entire department based on skill gaps
 * @access Private (HR and Managers only)
 */
router.get('/training/recommendations/department/:departmentId', authenticate, authorize(['admin', 'hr']), async (req, res) => {
  try {
    const departmentId = req.params.departmentId;
    
    if (!departmentId.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid department ID" 
      });
    }
    
    const result = await getSkillGapRecommendations(departmentId);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    console.error('Error getting department training recommendations:', error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while getting department training recommendations", 
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
