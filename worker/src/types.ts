export type Env = {
  MONGODB_URI: string;
  JWT_SECRET: string;
};

export type Role = "CEO" | "Manager" | "Staff";

export type AuthUser = {
  id: string;
  businessId: string;
  role: Role;
  name: string;
};
