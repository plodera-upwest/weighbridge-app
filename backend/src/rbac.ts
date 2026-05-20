import { Permission, Role, User } from "./types";

export const rolePermissions: Record<Role, Permission[]> = {
  ADMIN: [
    "CREATE_TRANSACTION",
    "EDIT_TRANSACTION",
    "APPROVE_CORRECTION",
    "PRINT_SLIP",
    "REPRINT_SLIP",
    "VIEW_REPORTS",
    "MANAGE_USERS",
    "MANAGE_PRODUCTS",
    "MANAGE_VEHICLES",
    "MANAGE_DRIVERS",
    "MANAGE_PARTIES",
    "CHANGE_SETTINGS",
    "CAPTURE_FIRST_WEIGHT",
    "CAPTURE_PRODUCT_WEIGHT",
    "CAPTURE_FINAL_WEIGHT",
    "VIEW_AUDIT_LOGS"
  ],
  WEIGHBRIDGE_OPERATOR: [
    "CREATE_TRANSACTION",
    "PRINT_SLIP",
    "CAPTURE_FIRST_WEIGHT",
    "CAPTURE_PRODUCT_WEIGHT",
    "CAPTURE_FINAL_WEIGHT"
  ],
  ACCOUNTS: ["VIEW_REPORTS", "PRINT_SLIP", "REPRINT_SLIP"],
  STORE_DISPATCH: ["CREATE_TRANSACTION", "CAPTURE_PRODUCT_WEIGHT", "VIEW_REPORTS"],
  VIEWER: ["VIEW_REPORTS"]
};

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    permissions: rolePermissions[user.role]
  };
}

export function hasPermission(user: User, permission: Permission) {
  return rolePermissions[user.role].includes(permission);
}
