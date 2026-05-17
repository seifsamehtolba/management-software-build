import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import type { AppRole } from "@/lib/appRole";
import { prisma } from "@/lib/prisma";
import { legacyRoleToPermissions, normalizePermissions } from "@/lib/permissions";

type AuthToken = JWT & {
  role?: string;
  branchId?: string | null;
  permissions?: string[];
};

type AuthUser = {
  role: string;
  branchId: string | null;
  permissions: string[];
};

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.isActive) return null;

        const passwordValid = await compare(credentials.password, user.passwordHash);
        if (!passwordValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          permissions:
            normalizePermissions(user.permissions as string[]).length > 0
              ? normalizePermissions(user.permissions as string[])
              : legacyRoleToPermissions(user.role),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const safeUser = user as unknown as AuthUser;
        (token as AuthToken).role = safeUser.role;
        (token as AuthToken).branchId = safeUser.branchId;
        (token as AuthToken).permissions = safeUser.permissions;
      } else if (!(token as AuthToken).permissions?.length) {
        (token as AuthToken).permissions = legacyRoleToPermissions(
          (((token as AuthToken).role as AppRole | undefined) ?? null),
        );
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const safeToken = token as AuthToken;
        session.user.id = token.sub ?? "";
        session.user.role = safeToken.role ?? "CASHIER";
        session.user.branchId = safeToken.branchId ?? null;
        session.user.permissions =
          safeToken.permissions?.length
            ? safeToken.permissions
            : legacyRoleToPermissions(((safeToken.role as AppRole | undefined) ?? null));
      }
      return session;
    },
  },
};
