import type { ApiEmployee } from '@/lib/api-types';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate, getStatusClass } from "@/lib/utils";
import AddEditEmployeeModal from "@/components/employee/AddEditEmployeeModal";
import EmployeeProfile from "@/components/employee/EmployeeProfile";

export default function EmployeeDatabase() {
  const [searchQuery, setSearchQuery] = useState("");
  const [employeeType, setEmployeeType] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  
  // Fetch employees - in a real app this would come from an API
  const { data: employees, isLoading, error, refetch } = useQuery<ApiEmployee[]>({
    queryKey: ['/api/employees', { type: employeeType !== 'all' ? employeeType : undefined }],
    staleTime: 1000 * 60, // 1 minute
  });

  const displayEmployees=employees || [];

  // Filter employees based on search query
  const filteredEmployees = displayEmployees.filter(employee => {
    const fullName = `${employee.firstName} ${employee.lastName}`.toLowerCase();
    const query = searchQuery.toLowerCase();
    return fullName.includes(query) || 
      employee.employeeId.toLowerCase().includes(query) ||
      employee.position.toLowerCase().includes(query) ||
      employee.department.toLowerCase().includes(query);
  });

  // View employee profile
  const handleViewEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId);
  };

  // Close employee profile view
  const handleCloseProfile = () => {
    setSelectedEmployeeId(null);
  };

  // If an employee is selected, show their profile
  if (selectedEmployeeId) {
    return (
      <EmployeeProfile 
        employeeId={selectedEmployeeId} 
        onClose={handleCloseProfile} 
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xl font-poppins font-semibold">Employee Database</CardTitle>
          <Button className="bg-primary hover:bg-primary/90" onClick={() => setShowAddModal(true)}>
            <i className="fas fa-plus mr-2"></i> Add Employee
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4 sm:flex-row sm:space-y-0 sm:space-x-4 mb-6">
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400"></i>
            </div>
            <div className="flex space-x-2">
              <Button 
                variant={employeeType === "all" ? "default" : "outline"}
                onClick={() => setEmployeeType("all")}
                className="min-w-[100px]"
              >
                All
              </Button>
              <Button 
                variant={employeeType === "permanent" ? "default" : "outline"}
                onClick={() => setEmployeeType("permanent")}
                className="min-w-[100px]"
              >
                Permanent
              </Button>
              <Button 
                variant={employeeType === "temporary" ? "default" : "outline"}
                onClick={() => setEmployeeType("temporary")}
                className="min-w-[100px]"
              >
                Temporary
              </Button>
              <Button 
                variant={employeeType === "contract" ? "default" : "outline"}
                onClick={() => setEmployeeType("contract")}
                className="min-w-[100px]"
              >
                Contract
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Employee ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Position</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Joining Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-sm text-center text-neutral-500">Loading employees...</td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-sm text-center text-error">Error loading employees</td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-sm text-center text-neutral-500">No employees found</td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-neutral-50 cursor-pointer" onClick={() => handleViewEmployee(employee.id)}>
                      <td className="px-4 py-3 text-sm text-neutral-800">{employee.employeeId}</td>
                      <td className="px-4 py-3 text-sm font-medium text-neutral-800">
                        {employee.firstName} {employee.lastName}
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">{employee.position}</td>
                      <td className="px-4 py-3 text-sm text-neutral-800">{employee.department}</td>
                      <td className="px-4 py-3 text-sm text-neutral-800 capitalize">{employee.type}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusClass(employee.status)}`}>
                          {employee.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-800">{formatDate(employee.joiningDate)}</td>
                      <td className="px-4 py-3 text-sm text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                        <button 
                          className="text-primary hover:text-primary-dark"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewEmployee(employee.id);
                          }}
                        >
                          <i className="fas fa-eye"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Employee Modal */}
      <AddEditEmployeeModal 
        open={showAddModal} 
        onOpenChange={setShowAddModal} 
        onSuccess={() => {
          refetch();
        }}
      />
    </div>
  );
}
