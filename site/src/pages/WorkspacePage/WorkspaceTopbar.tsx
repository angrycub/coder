import { type Interpolation, type Theme, useTheme } from "@emotion/react";
import Link from "@mui/material/Link";
import { ChevronLeftIcon, CircleDollarSign, TrashIcon } from "lucide-react";
import type { FC } from "react";
import { useQuery } from "react-query";
import { Link as RouterLink } from "react-router";
import { workspaceQuota } from "#/api/queries/workspaceQuota";
import type * as TypesGen from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import {
	Topbar,
	TopbarAvatar,
	TopbarData,
	TopbarDivider,
	TopbarIcon,
	TopbarIconButton,
} from "#/components/FullPageLayout/Topbar";
import {
	HelpTooltip,
	HelpTooltipContent,
	HelpTooltipTrigger,
} from "#/components/HelpTooltip/HelpTooltip";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { WorkspaceStatusIndicator } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStatusIndicator";
import { displayDormantDeletion } from "#/utils/dormant";
import { formatDate } from "#/utils/time";
import type { WorkspacePermissions } from "../../modules/workspaces/permissions";
import { WorkspaceActions } from "./WorkspaceActions/WorkspaceActions";
import { WorkspaceNotifications } from "./WorkspaceNotifications/WorkspaceNotifications";
import { WorkspaceScheduleControls } from "./WorkspaceScheduleControls";

interface WorkspaceProps {
	isUpdating: boolean;
	isRestarting: boolean;
	workspace: TypesGen.Workspace;
	template: TypesGen.Template;
	permissions: WorkspacePermissions;
	latestVersion?: TypesGen.TemplateVersion;
	handleStart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleStop: () => void;
	handleRestart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleUpdate: () => void;
	handleCancel: () => void;
	handleDormantActivate: () => void;
	handleRetry: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleDebug: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleToggleFavorite: () => void;
}

export const WorkspaceTopbar: FC<WorkspaceProps> = ({
	workspace,
	template,
	latestVersion,
	permissions,
	isUpdating,
	isRestarting,
	handleStart,
	handleStop,
	handleRestart,
	handleUpdate,
	handleCancel,
	handleDormantActivate,
	handleToggleFavorite,
	handleRetry,
	handleDebug,
}) => {
	const { entitlements, organizations, showOrganizations } = useDashboard();
	const getLink = useLinks();
	const theme = useTheme();

	// Quota
	const hasDailyCost = workspace.latest_build.daily_cost > 0;
	const { data: quota } = useQuery({
		...workspaceQuota(workspace.organization_name, workspace.owner_name),

		// Don't need to tie the enabled condition to showOrganizations because
		// even if the customer hasn't enabled the orgs enterprise feature, all
		// workspaces have an associated organization under the hood
		enabled: hasDailyCost,
	});

	// Dormant
	const allowAdvancedScheduling =
		entitlements.features.advanced_template_scheduling.enabled;
	// This check can be removed when https://github.com/coder/coder/milestone/19
	// is merged up
	const shouldDisplayDormantData = displayDormantDeletion(
		workspace,
		allowAdvancedScheduling,
	);

	const activeOrg = organizations.find(
		(org) => org.id === workspace.organization_id,
	);

	const orgDisplayName = activeOrg?.display_name || workspace.organization_name;

	const isImmutable =
		workspace.latest_build.status === "deleted" ||
		workspace.latest_build.status === "deleting";

	const templateLink = getLink(
		linkToTemplate(workspace.organization_name, workspace.template_name),
	);

	return (
		<Topbar css={{ gridArea: "topbar" }}>
			<Tooltip>
				<TooltipTrigger asChild>
					<TopbarIconButton component={RouterLink} to="/workspaces">
						<ChevronLeftIcon className="size-icon-sm" />
					</TopbarIconButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Back to workspaces</TooltipContent>
			</Tooltip>

			<div className="flex items-center gap-y-6 gap-x-2 flex-wrap px-3 py-2 mr-auto">
				<TopbarData>
					<OwnerBreadcrumb
						ownerName={workspace.owner_name}
						ownerAvatarUrl={workspace.owner_avatar_url}
					/>

					{showOrganizations && (
						<>
							<TopbarDivider />
							<OrganizationBreadcrumb
								orgName={orgDisplayName}
								orgIconUrl={activeOrg?.icon}
								orgPageUrl={`/organizations/${encodeURIComponent(workspace.organization_name)}`}
							/>
						</>
					)}

					<TopbarDivider />

					<WorkspaceBreadcrumb
						workspaceName={workspace.name}
						templateIconUrl={workspace.template_icon}
						rootTemplateUrl={templateLink}
						templateVersionName={workspace.latest_build.template_version_name}
						templateDisplayName={
							workspace.template_display_name || workspace.template_name
						}
						latestBuildVersionName={
							workspace.latest_build.template_version_name
						}
					/>
				</TopbarData>

				{quota && quota.budget > 0 && (
					<Link
						component={RouterLink}
						css={{ color: "inherit" }}
						to={
							showOrganizations
								? `/workspaces?filter=organization:${encodeURIComponent(workspace.organization_name)}`
								: "/workspaces"
						}
						title={
							showOrganizations
								? `See affected workspaces for ${orgDisplayName}`
								: "See affected workspaces"
						}
					>
						<TopbarData>
							<TopbarIcon>
								<CircleDollarSign
									className="size-icon-sm"
									aria-label="Daily usage"
								/>
							</TopbarIcon>

							<span>
								<ResourceCostTooltip
									resources={workspace.latest_build.resources}
									dailyCost={workspace.latest_build.daily_cost}
								/>{" "}
								<span css={{ color: theme.palette.text.secondary }}>
									credits of
								</span>{" "}
								{quota.budget}
							</span>
						</TopbarData>
					</Link>
				)}
				{shouldDisplayDormantData && (
					<TopbarData>
						<TopbarIcon>
							<TrashIcon />
						</TopbarIcon>
						<Link
							component={RouterLink}
							to={`${templateLink}/settings/schedule`}
							title="Schedule settings"
							css={{ color: "inherit" }}
						>
							{workspace.deleting_at ? (
								<>Deletion on {formatDate(new Date(workspace.deleting_at))}</>
							) : (
								"Deletion soon"
							)}
						</Link>
					</TopbarData>
				)}
			</div>

			{!isImmutable && (
				<div className="flex items-center gap-4">
					<WorkspaceScheduleControls
						workspace={workspace}
						template={template}
						canUpdateSchedule={permissions.updateWorkspace}
					/>

					<WorkspaceNotifications
						workspace={workspace}
						template={template}
						latestVersion={latestVersion}
						permissions={permissions}
						onRestartWorkspace={handleRestart}
						onUpdateWorkspace={handleUpdate}
						onActivateWorkspace={handleDormantActivate}
					/>

					<WorkspaceStatusIndicator workspace={workspace} />

					<WorkspaceActions
						workspace={workspace}
						permissions={permissions}
						isUpdating={isUpdating}
						isRestarting={isRestarting}
						handleStart={handleStart}
						handleStop={handleStop}
						handleRestart={handleRestart}
						handleUpdate={handleUpdate}
						handleCancel={handleCancel}
						handleRetry={handleRetry}
						handleDebug={handleDebug}
						handleDormantActivate={handleDormantActivate}
						handleToggleFavorite={handleToggleFavorite}
					/>
				</div>
			)}
		</Topbar>
	);
};

type OwnerBreadcrumbProps = Readonly<{
	ownerName: string;
	ownerAvatarUrl: string;
}>;

const OwnerBreadcrumb: FC<OwnerBreadcrumbProps> = ({
	ownerName,
	ownerAvatarUrl,
}) => {
	return (
		<HelpTooltip>
			<HelpTooltipTrigger asChild>
				<span css={styles.breadcrumbSegment}>
					<Avatar size="sm" fallback={ownerName} src={ownerAvatarUrl} />
					<span css={styles.breadcrumbText}>{ownerName}</span>
				</span>
			</HelpTooltipTrigger>

			<HelpTooltipContent align="center">
				<AvatarData title={ownerName} subtitle="Owner" src={ownerAvatarUrl} />
			</HelpTooltipContent>
		</HelpTooltip>
	);
};

type OrganizationBreadcrumbProps = Readonly<{
	orgName: string;
	orgPageUrl?: string;
	orgIconUrl?: string;
}>;

const OrganizationBreadcrumb: FC<OrganizationBreadcrumbProps> = ({
	orgName,
	orgPageUrl,
	orgIconUrl,
}) => {
	return (
		<HelpTooltip>
			<HelpTooltipTrigger asChild>
				<span css={styles.breadcrumbSegment}>
					<Avatar
						size="sm"
						variant="icon"
						src={orgIconUrl}
						fallback={orgName}
					/>
					<span css={styles.breadcrumbText}>{orgName}</span>
				</span>
			</HelpTooltipTrigger>

			<HelpTooltipContent align="center">
				<AvatarData
					title={
						orgPageUrl ? (
							<Link
								component={RouterLink}
								to={orgPageUrl}
								css={{ color: "inherit" }}
							>
								{orgName}
							</Link>
						) : (
							orgName
						)
					}
					subtitle="Organization"
					avatar={
						orgIconUrl && (
							<Avatar
								variant="icon"
								src={orgIconUrl}
								fallback={orgName}
								size="md"
							/>
						)
					}
					imgFallbackText={orgName}
				/>
			</HelpTooltipContent>
		</HelpTooltip>
	);
};

type WorkspaceBreadcrumbProps = Readonly<{
	workspaceName: string;
	templateIconUrl: string;
	rootTemplateUrl: string;
	templateVersionName: string;
	latestBuildVersionName: string;
	templateDisplayName: string;
}>;

const WorkspaceBreadcrumb: FC<WorkspaceBreadcrumbProps> = ({
	workspaceName,
	templateIconUrl,
	rootTemplateUrl,
	templateVersionName,
	latestBuildVersionName,
	templateDisplayName,
}) => {
	return (
		<div className="flex items-center">
			<HelpTooltip>
				<HelpTooltipTrigger asChild>
					<span css={styles.breadcrumbSegment}>
						<TopbarAvatar
							src={templateIconUrl}
							fallback={templateDisplayName}
						/>

						<span css={[styles.breadcrumbText, { fontWeight: 500 }]}>
							{workspaceName}
						</span>
					</span>
				</HelpTooltipTrigger>

				<HelpTooltipContent align="center">
					<AvatarData
						title={
							<Link
								component={RouterLink}
								to={rootTemplateUrl}
								css={{ color: "inherit" }}
							>
								{templateDisplayName}
							</Link>
						}
						subtitle={
							<Link
								component={RouterLink}
								to={`${rootTemplateUrl}/versions/${encodeURIComponent(templateVersionName)}`}
								css={{ color: "inherit" }}
							>
								Version: {latestBuildVersionName}
							</Link>
						}
						avatar={
							<Avatar
								variant="icon"
								src={templateIconUrl}
								fallback={templateDisplayName}
								size="md"
							/>
						}
						imgFallbackText={templateDisplayName}
					/>
				</HelpTooltipContent>
			</HelpTooltip>
			<CopyButton text={workspaceName} label="Copy workspace name" />
		</div>
	);
};

const styles = {
	breadcrumbSegment: {
		display: "flex",
		alignItems: "center",
		flexFlow: "row nowrap",
		gap: "8px",
		maxWidth: "160px",
		whiteSpace: "nowrap",
		cursor: "default",
	},

	breadcrumbText: {
		overflowX: "hidden",
		textOverflow: "ellipsis",
	},
} satisfies Record<string, Interpolation<Theme>>;

type ResourceCostTooltipProps = Readonly<{
	resources: readonly TypesGen.WorkspaceResource[];
	dailyCost: number;
}>;

const ResourceCostTooltip: FC<ResourceCostTooltipProps> = ({
	resources,
	dailyCost,
}) => {
	const costResources = resources.filter((r) => r.daily_cost > 0);

	// The build-level daily_cost includes costs from Coder-internal
	// resources (e.g. coder_agent) that are not represented as visible
	// workspace resources. Show the difference as "Coder resources".
	//
	// TODO: Update the Coder Terraform provider to emit a warning when
	// daily_cost is assigned via coder_metadata to a Coder resource type
	// (coder_agent, coder_app, etc.) so template authors understand that
	// those costs won't appear discretely in the UI.
	const visibleCostTotal = costResources.reduce(
		(sum, r) => sum + r.daily_cost,
		0,
	);
	const coderResourceCost = dailyCost - visibleCostTotal;

	if (costResources.length === 0 && coderResourceCost <= 0) {
		return <span>{dailyCost}</span>;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="cursor-default border-0 border-b border-dashed border-current">
					{dailyCost}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-64 p-0">
				<div className="px-3 pt-2 pb-1 text-2xs font-medium text-content-secondary">
					Resource breakdown
				</div>
				<ul className="m-0 list-none p-0">
					{costResources.map((r) => (
						<li
							key={r.id}
							className="flex items-center justify-between gap-4 px-3 py-1 text-xs"
						>
							<span className="truncate text-content-secondary">
								{r.name}
								<span className="ml-1 text-content-disabled">{r.type}</span>
							</span>
							<span className="shrink-0 tabular-nums text-content-primary">
								{r.daily_cost}
							</span>
						</li>
					))}
					{coderResourceCost > 0 && (
						<li className="flex items-center justify-between gap-4 px-3 py-1 text-xs">
							<span className="truncate text-content-secondary italic">
								Coder resources
							</span>
							<span className="shrink-0 tabular-nums text-content-primary">
								{coderResourceCost}
							</span>
						</li>
					)}
				</ul>
				<div className="flex items-center justify-between gap-4 border-0 border-t border-solid border-border px-3 py-1.5 text-xs font-medium">
					<span className="text-content-secondary">Total</span>
					<span className="tabular-nums text-content-primary">{dailyCost}</span>
				</div>
			</TooltipContent>
		</Tooltip>
	);
};
