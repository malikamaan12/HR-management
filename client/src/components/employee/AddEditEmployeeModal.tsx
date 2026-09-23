import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import EmployeeForm from "./EmployeeForm";

interface AddEditEmployeeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: any;
  onSuccess: (employeeId?: number) => void;
}

export default function AddEditEmployeeModal({ open, onOpenChange, employee, onSuccess }: AddEditEmployeeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{employee ? "Edit Employee" : "Add New Employee"}</DialogTitle>
          <DialogDescription>
            {employee 
              ? "Update employee details in the system" 
              : "Enter employee information to add them to the system"}
          </DialogDescription>
        </DialogHeader>
        <EmployeeForm 
          employee={employee} 
          onCancel={() => onOpenChange(false)}
          onSuccess={(id) => {
            onSuccess(id);
            onOpenChange(false);
          }} 
        />
      </DialogContent>
    </Dialog>
  );
}
