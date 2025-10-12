import { config } from "dotenv";
import { Request, Response } from "express";
import { eq, ilike, count, desc } from "drizzle-orm";

import { db } from "../drizzle";
import { verifyToken } from "../lib/auth";
import { user } from "../drizzle/schema";
import { formatZodError } from "../lib/utils";
import { getUserByEmailAndOauthId } from "../lib/service/user-service";
import { schoolEmailSchema, tokenTypeUnionSchema } from "../lib/schema";

config({ path: ".env.local" });

export async function createUser(req: Request, res: Response) {
  const { name, email, profileImage, oauthId } = req.body;

  const missingFields = [];
  if (!name) missingFields.push("name");
  if (!email) missingFields.push("email");
  if (!profileImage) missingFields.push("profileImage");
  if (!oauthId) missingFields.push("oauthId");

  if (missingFields.length > 0) {
    return res.status(400).send({
      message: `Missing required fields: ${missingFields.join(", ")}`,
      error: "Bad Request",
      statusCode: 400,
    });
  }

  const isValidEmail = schoolEmailSchema.safeParse(email);

  if (isValidEmail.error) {
    return res.status(400).send({
      message: formatZodError(isValidEmail.error),
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const userExist = await getUserByEmailAndOauthId(email, oauthId);

    if (userExist) {
      return res.status(200).send({
        message: "User already exists",
        statusCode: 200,
        data: userExist,
      });
    }

    const newUserValues = {
      name,
      email,
      oauthId,
      profileImage,
    };

    const [newUser] = await db.insert(user).values(newUserValues).returning();

    return res.status(201).send({
      message: "User created successfully",
      statusCode: 201,
      data: newUser,
    });
  } catch (error) {
    return res.status(500).send({
      message:
        "An unexpected error occurred while creating the account. Please try again later. If the problem persists, contact support.",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function getAllUsers(req: Request, res: Response) {
  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const { name, page = "1", pageSize = "10" } = req.query;
    const pageNumber = parseInt(page as string);
    const size = parseInt(pageSize as string);
    const offset = (pageNumber - 1) * size;

    if (name) {
      const [data, totalResult] = await Promise.all([
        db
          .select()
          .from(user)
          .where(ilike(user.name, `%${name}%`))
          .orderBy(desc(user.createdAt))
          .limit(size)
          .offset(offset),
        db
          .select({ count: count() })
          .from(user)
          .where(ilike(user.name, `%${name}%`)),
      ]);

      const total = totalResult[0]?.count || 0;
      const totalPages = Math.ceil(total / size);

      return res.status(200).send({
        message: data.length
          ? "Users retrieved successfully"
          : "No users found in the database",
        statusCode: 200,
        data,
        pagination: {
          page: pageNumber,
          pageSize: size,
          total,
          totalPages,
          hasNextPage: pageNumber < totalPages,
          hasPreviousPage: pageNumber > 1,
        },
      });
    }

    const [data, totalResult] = await Promise.all([
      db
        .select()
        .from(user)
        .orderBy(desc(user.createdAt))
        .limit(size)
        .offset(offset),
      db.select({ count: count() }).from(user),
    ]);

    const total = totalResult[0]?.count || 0;
    const totalPages = Math.ceil(total / size);

    return res.status(200).send({
      message: data.length
        ? "Users retrieved successfully"
        : "No users found in the database",
      statusCode: 200,
      data,
      pagination: {
        page: pageNumber,
        pageSize: size,
        total,
        totalPages,
        hasNextPage: pageNumber < totalPages,
        hasPreviousPage: pageNumber > 1,
      },
    });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? error.message
          : "There was an error retrieving users data.",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function getUserByUserId(req: Request, res: Response) {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).send({
      message: "User ID is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const [data] = await db.select().from(user).where(eq(user.id, userId));

    if (!data) {
      return res.status(404).send({
        message: "User not found",
        error: "Not Found",
        statusCode: 404,
      });
    }

    return res
      .status(200)
      .send({ message: "User found", statusCode: 200, data });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? error.message
          : "There was an error retrieving the user data.",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function toggleAlertNotification(req: Request, res: Response) {
  const { userId } = req.params;
  const { alertNotification } = req.body;

  if (!userId) {
    return res.status(400).send({
      message: "User ID is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  if (typeof alertNotification !== "boolean") {
    return res.status(400).send({
      message: "alertNotification must be a boolean value",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const [userExists] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId));

    if (!userExists) {
      return res.status(404).send({
        message: "User not found",
        error: "Not Found",
        statusCode: 404,
      });
    }

    const [updatedUser] = await db
      .update(user)
      .set({ alertNotification })
      .where(eq(user.id, userId))
      .returning();

    if (!updatedUser) {
      return res.status(404).send({
        message: "Failed to update notification preferences",
        error: "Update Failed",
        statusCode: 404,
      });
    }

    return res.status(200).send({
      message: `Alert notifications ${
        alertNotification ? "enabled" : "disabled"
      } successfully`,
      statusCode: 200,
      data: { alertNotification: updatedUser.alertNotification },
    });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? `Error updating notification preferences: ${error.message}`
          : "An unexpected error occurred while updating notification preferences",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function deleteUserByUserId(req: Request, res: Response) {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).send({
      message: "User ID is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const [userExists] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId));

    if (!userExists) {
      return res.status(404).send({
        message: "User not found",
        error: "Not Found",
        statusCode: 404,
      });
    }

    const [deletedUser] = await db
      .delete(user)
      .where(eq(user.id, userId))
      .returning();

    if (!deletedUser) {
      return res.status(404).send({
        message: "Failed to delete the user",
        error: "Delete Failed",
        statusCode: 404,
      });
    }

    return res.status(200).send({
      message: `User deleted successfully`,
      statusCode: 200,
      data: deletedUser,
    });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? `Error deleting user: ${error.message}`
          : "An unexpected error occurred while deleting user",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function switchUserRole(req: Request, res: Response) {
  const { userId } = req.params;
  const { role } = req.body;

  if (!userId) {
    return res.status(400).send({
      message: "User ID is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  const isValidRole = tokenTypeUnionSchema.safeParse(role);

  if (isValidRole.error) {
    return res.status(400).send({
      message: "Invalid role value",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const [userExists] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId));

    if (!userExists) {
      return res.status(404).send({
        message: "User not found",
        error: "Not Found",
        statusCode: 404,
      });
    }

    const [updatedUser] = await db
      .update(user)
      .set({ role })
      .where(eq(user.id, userId))
      .returning();

    if (!updatedUser) {
      return res.status(404).send({
        message: "Failed to update user role",
        error: "Update Failed",
        statusCode: 404,
      });
    }

    return res.status(200).send({
      message: `User role updated to ${role} successfully`,
      statusCode: 200,
      data: { role: updatedUser.role },
    });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? `Error updating user role: ${error.message}`
          : "An unexpected error occurred while updating user role",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}

export async function updateExpoPushToken(req: Request, res: Response) {
  const { userId } = req.params;
  const { expoPushToken } = req.body;

  if (!userId) {
    return res.status(400).send({
      message: "User ID is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  if (!expoPushToken) {
    return res.status(400).send({
      message: "Expo push token is required",
      error: "Bad Request",
      statusCode: 400,
    });
  }

  try {
    const isValidToken = await verifyToken(req);

    if (!isValidToken?.isValidToken) {
      return res.status(401).send({
        message: "Invalid or expired authentication token",
        error: "Unauthorized",
        statusCode: 401,
      });
    }

    const [userExists] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId));

    if (!userExists) {
      return res.status(404).send({
        message: "User not found",
        error: "Not Found",
        statusCode: 404,
      });
    }

    const [updatedUser] = await db
      .update(user)
      .set({ expoPushToken })
      .where(eq(user.id, userId))
      .returning();

    if (!updatedUser) {
      return res.status(404).send({
        message: "Failed to update push token",
        error: "Update Failed",
        statusCode: 404,
      });
    }

    return res.status(200).send({
      message: "Push token updated successfully",
      statusCode: 200,
      data: { expoPushToken: updatedUser.expoPushToken },
    });
  } catch (error) {
    return res.status(500).send({
      message:
        error instanceof Error
          ? `Error updating push token: ${error.message}`
          : "An unexpected error occurred while updating push token",
      error: "Internal Server Error",
      statusCode: 500,
    });
  }
}
