import { z } from "zod";

const csvSchema = z.string().transform((value) =>
	value
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean),
);

export const runtimeEnvSchema = z.object({
	ACCESS_TEAM_DOMAIN: z
		.string()
		.trim()
		.min(1)
		.regex(/^[a-z0-9.-]+\.cloudflareaccess\.com$/i),
	ACCESS_AUDIENCE: z.string().trim().min(1),
	ADMIN_ORIGIN: z.url().refine((value) => new URL(value).origin === value),
	ACCESS_ALLOWED_EMAILS: csvSchema,
	ACCESS_ALLOWED_SUBJECTS: csvSchema,
	APP_ENV: z.enum(["development", "test", "production"]).default("production"),
	/**
	 * 站点标识，决定加载哪一份 `src/sites/<id>.ts` 内容模型。
	 *
	 * 这里声明为可选：全局 Access 配置不应因为文章侧还没配好而整体下线。真正的「必填」
	 * 由文章模块初始化时的 `resolveSiteConfig` 强制执行——缺失即 503，且**不设默认值**，
	 * 否则漏配的部署会静默套用错误站点的路径策略，把文章写到错误位置。
	 */
	SITE_ID: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[a-z0-9][a-z0-9-]*$/)
		.optional(),
	RATE_LIMITER: z
		.custom<{ limit(options: { key: string }): Promise<{ success: boolean }> }>(
			(value) =>
				typeof value === "object" &&
				value !== null &&
				typeof Reflect.get(value, "limit") === "function",
		)
		.optional(),
});

export type ValidatedRuntimeConfig = z.infer<typeof runtimeEnvSchema>;
