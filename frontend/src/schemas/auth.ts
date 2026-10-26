import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .max(320, "Email is too long")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(1024, "Password is too long"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .max(320, "Email is too long")
    .email("Enter a valid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(1024, "Password is too long"),
    passwordConfirmation: z.string().min(1, "Confirm your password"),
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: "Passwords do not match",
    path: ["passwordConfirmation"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
