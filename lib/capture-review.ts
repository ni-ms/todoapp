import type { Draft } from "./ai-contract";

/** Suggested task order must be selected explicitly in review before it can block planning. */
export function prepareDraftReview(drafts: Draft[]) {
    return drafts.map((draft) => ({
        ...draft,
        suggestedDependencies: [...draft.scheduling.dependencies],
        scheduling: { ...draft.scheduling, dependencies: [] as string[] },
    }));
}
