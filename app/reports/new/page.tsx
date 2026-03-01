import { ReportForm } from "@/components/report-form";
import { ReportTargetType } from "@/lib/types";

interface NewReportPageProps {
  searchParams: Promise<{
    targetType?: string;
    targetId?: string;
  }>;
}

function parseTargetType(raw: string | undefined): ReportTargetType {
  if (raw === "problem" || raw === "contest" || raw === "submission") {
    return raw;
  }
  return "problem";
}

export default async function NewReportPage({ searchParams }: NewReportPageProps) {
  const params = await searchParams;
  const targetType = parseTargetType(params.targetType);
  const targetId = params.targetId ?? "";

  return (
    <div className="page">
      <section className="page-head">
        <div>
          <h1 className="page-title">Create Report</h1>
          <p className="page-subtitle">
            不適切コンテンツや問題不備の通報を管理者に送信します。
          </p>
        </div>
      </section>
      <section className="panel">
        <ReportForm targetType={targetType} targetId={targetId} />
      </section>
    </div>
  );
}
