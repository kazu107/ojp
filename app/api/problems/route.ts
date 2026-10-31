import { problemTags, studyEntries, discoveryStatuses } from "@/lib/problem-workspace-store";
import { filterProblems, problemProgress, type DiscoveryFilters } from "@/lib/problem-discovery";
import { listSubmissionsForViewer } from "@/lib/store";
import { NextResponse } from "next/server";
import {
  paginateItems,
  parseExplanationVisibility,
  parseOptionalIntegerOrNull,
  parsePaginationQuery,
  parsePositiveNumber,
  parseString,
  parseTestCaseVisibility,
  parseVisibility,
} from "@/lib/api-helpers";
import {
  createProblem,
  getOptionalCurrentUser,
  listProblemsForListView,
} from "@/lib/store";
import { apiError, errorResponse } from "@/lib/api-response";

export async function GET(request: Request) {
  try {
    const user = await getOptionalCurrentUser();
    const pagination = parsePaginationQuery(new URL(request.url).searchParams, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    const params=new URL(request.url).searchParams;
    if(!user && ((params.get("progress") && params.get("progress")!=="all")||params.get("saved")==="1"))return apiError(401,"authentication required");
    const all=listProblemsForListView(user?.id ?? "guest");
    const tags=await problemTags(all.map(problem=>problem.id));
    const progress=problemProgress(user?await discoveryStatuses(listSubmissionsForViewer(user.id,{userId:user.id})):[]);
    const saved=new Set(user?(await studyEntries(user.id)).filter(row=>row.bookmarked).map(row=>row.problemId):[]);
    const filters=Object.fromEntries(["q","tag","min","max","progress","saved"].map(key=>[key,params.get(key)??undefined])) as DiscoveryFilters;
    const { items, meta } = paginateItems(
      filterProblems(all,filters,tags,progress,saved),
      pagination,
    );
    return NextResponse.json({ problems:items.map(problem=>({...problem,tags:tags.get(problem.id)??[]})), pagination: meta });
  } catch (error) {
    return errorResponse(error, "failed to fetch problems");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const difficulty = parseOptionalIntegerOrNull(body.difficulty);
    const problem = await createProblem({
      title: parseString(body.title).trim(),
      slug: parseString(body.slug).trim(),
      statementMarkdown: parseString(body.statementMarkdown),
      inputDescription: parseString(body.inputDescription),
      outputDescription: parseString(body.outputDescription),
      constraintsMarkdown: parseString(body.constraintsMarkdown),
      explanationMarkdown: parseString(body.explanationMarkdown),
      explanationVisibility: parseExplanationVisibility(body.explanationVisibility, "private"),
      visibility: parseVisibility(body.visibility, "private"),
      difficulty: difficulty === undefined ? null : difficulty,
      timeLimitMs: parsePositiveNumber(body.timeLimitMs, 2000),
      memoryLimitMb: parsePositiveNumber(body.memoryLimitMb, 512),
      testCaseVisibility: parseTestCaseVisibility(body.testCaseVisibility, "case_index_only"),
    });
    return NextResponse.json({ problem }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "problem creation failed");
  }
}
