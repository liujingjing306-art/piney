<script lang="ts">
	import * as Card from "$lib/components/ui/card/index.js";
	import {
		FieldGroup,
		Field,
		FieldLabel,
		FieldDescription,
		FieldSeparator,
	} from "$lib/components/ui/field/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { auth } from "$lib/stores/auth.svelte";
	import { API_BASE } from "$lib/api";

	let { class: className, ...restProps }: HTMLAttributes<HTMLDivElement> =
		$props();

	const id = $props.id();
	let username = $state("");
	let password = $state("");
	let loading = $state(false);
	let error = $state("");
	let recoveryOpen = $state(false);
	let recoveryUsername = $state("");
	let recoveryPassword = $state("");
	let recoveryPasswordConfirm = $state("");
	let recoveryLoading = $state(false);
	let recoveryError = $state("");
	let recoverySuccess = $state("");
	let recoveryTapCount = 0;
	let recoveryTapTimer: ReturnType<typeof setTimeout> | null = null;

	function resetRecoveryTapCount() {
		recoveryTapCount = 0;
		if (recoveryTapTimer) {
			clearTimeout(recoveryTapTimer);
			recoveryTapTimer = null;
		}
	}

	function handleRecoveryTrigger() {
		recoveryTapCount += 1;

		if (recoveryTapTimer) {
			clearTimeout(recoveryTapTimer);
		}

		recoveryTapTimer = setTimeout(resetRecoveryTapCount, 3000);

		if (recoveryTapCount >= 10) {
			resetRecoveryTapCount();
			recoveryError = "";
			recoverySuccess = "";
			recoveryOpen = true;
		}
	}

	async function restartApp() {
		if (
			typeof window !== "undefined" &&
			((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
		) {
			try {
				const { relaunch } = await import("@tauri-apps/plugin-process");
				await relaunch();
				return true;
			} catch (e) {
				console.error(e);
				return false;
			}
		} else if (typeof window !== "undefined") {
			window.location.reload();
			return true;
		}

		return false;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = "";
		loading = true;

		try {
			const res = await fetch(`${API_BASE}/api/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username, password }),
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || "登录失败");
			}

			const data = await res.json();
			auth.login(username, data.token);
		} catch (e: any) {
			console.error(e);
			error = e.message;
		} finally {
			loading = false;
		}
	}

	async function handleRecoverySubmit(e: Event) {
		e.preventDefault();
		recoveryError = "";
		recoverySuccess = "";

		const nextUsername = recoveryUsername.trim();
		const nextPassword = recoveryPassword;

		if (!nextUsername) {
			recoveryError = "请输入新的用户名";
			return;
		}

		if (!nextPassword) {
			recoveryError = "请输入新密码";
			return;
		}

		if (nextPassword !== recoveryPasswordConfirm) {
			recoveryError = "两次输入的新密码不一致";
			return;
		}

		recoveryLoading = true;

		try {
			const res = await fetch(`${API_BASE}/api/auth/recover`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: nextUsername,
					password: nextPassword,
				}),
			});

			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || "重置失败");
			}

			localStorage.removeItem("auth_token");
			recoverySuccess = "用户名和密码已更新，正在重启应用...";
			const restarted = await restartApp();
			if (!restarted) {
				recoverySuccess = "用户名和密码已更新，请退出应用后重新打开。";
			}
		} catch (e: any) {
			console.error(e);
			recoveryError = e.message || "重置失败，请稍后再试";
		} finally {
			recoveryLoading = false;
		}
	}
</script>

<div class={cn("flex flex-col gap-6", className)} {...restProps}>
	<Card.Root class="overflow-hidden p-0">
		<Card.Content class="grid p-0 md:grid-cols-2">
			<form class="p-6 md:p-8" onsubmit={handleSubmit}>
				<FieldGroup>
					<div class="flex flex-col items-center gap-2 text-center">
						<h1 class="text-2xl font-bold">你好！小兄许</h1>
						<p class="text-muted-foreground text-balance">
							使用用户名和密码登录
						</p>
					</div>
					<Field>
						<FieldLabel for="username-{id}">用户名</FieldLabel>
						<Input
							id="username-{id}"
							type="text"
							placeholder="请输入用户名"
							bind:value={username}
							required
						/>
					</Field>
					<Field>
						<FieldLabel for="password-{id}">密码</FieldLabel>
						<Input
							id="password-{id}"
							type="password"
							placeholder="请输入密码"
							bind:value={password}
							required
						/>
					</Field>
					{#if error}
						<div class="text-sm font-medium text-destructive">
							{error}
						</div>
					{/if}
					<Field>
						<Button type="submit" disabled={loading}>
							{loading ? "登录中..." : "登录"}
						</Button>
					</Field>
					<div>
						<p
							class="text-center text-muted-foreground text-balance text-xs"
						>
							首次使用小兄许？<a href="/sign-up" class="text-primary underline hover:no-underline">点击注册</a>
						</p>
					</div>
				</FieldGroup>
			</form>
			<div class="bg-muted relative hidden md:block">
				<img
					src="/login-bg.webp"
					alt="Login Background"
					class="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
				/>
			</div>
		</Card.Content>
	</Card.Root>
	<div class="pt-4">
		<FieldDescription
			class="cursor-default select-none px-6 text-center"
			onclick={handleRecoveryTrigger}
			title="本项目仅供个人使用"
		>
			本项目仅供个人使用，严禁用于商业用途 | Power By Laopobao
		</FieldDescription>
	</div>
</div>

<Dialog.Root bind:open={recoveryOpen}>
	<Dialog.Content class="sm:max-w-[425px]">
		<form class="space-y-5" onsubmit={handleRecoverySubmit}>
			<Dialog.Header>
				<Dialog.Title>重置登录信息</Dialog.Title>
				<Dialog.Description>
					输入新的用户名和密码，保存后应用会重启并使用新密码登录。
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4">
				<Field>
					<FieldLabel for="recovery-username-{id}">新的用户名</FieldLabel>
					<Input
						id="recovery-username-{id}"
						type="text"
						placeholder="请输入新的用户名"
						bind:value={recoveryUsername}
						required
						disabled={recoveryLoading}
					/>
				</Field>
				<Field>
					<FieldLabel for="recovery-password-{id}">新密码</FieldLabel>
					<Input
						id="recovery-password-{id}"
						type="password"
						placeholder="请输入新密码"
						bind:value={recoveryPassword}
						required
						disabled={recoveryLoading}
					/>
				</Field>
				<Field>
					<FieldLabel for="recovery-password-confirm-{id}">重复新密码</FieldLabel>
					<Input
						id="recovery-password-confirm-{id}"
						type="password"
						placeholder="请再次输入新密码"
						bind:value={recoveryPasswordConfirm}
						required
						disabled={recoveryLoading}
					/>
				</Field>
			</div>

			{#if recoveryError}
				<div class="text-sm font-medium text-destructive">
					{recoveryError}
				</div>
			{/if}

			{#if recoverySuccess}
				<div class="text-sm font-medium text-primary">
					{recoverySuccess}
				</div>
			{/if}

			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					disabled={recoveryLoading}
					onclick={() => (recoveryOpen = false)}
				>
					取消
				</Button>
				<Button type="submit" disabled={recoveryLoading}>
					{recoveryLoading ? "保存中..." : "保存并重启"}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
