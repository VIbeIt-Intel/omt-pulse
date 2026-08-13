import { useState } from "react";
import { ClipboardList, BookOpen, CheckSquare, Library } from "lucide-react";
import { canManageSurveyTemplates } from "@shared/security-survey";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { SurveyConduct } from "@/components/security-survey/survey-conduct";
import { SurveyFindings } from "@/components/security-survey/survey-findings";
import { SurveyLibrary } from "@/components/security-survey/survey-library";
import { SurveyCompleted } from "@/components/security-survey/survey-completed";

type Props = {
  userRole: string;
};

type TabId = "conduct" | "findings" | "library" | "completed";

export default function SecuritySurveyPage({ userRole }: Props) {
  const canManage = canManageSurveyTemplates(userRole);
  const [tab, setTab] = useState<TabId>("conduct");
  const [focusSurveyId, setFocusSurveyId] = useState<number | null>(null);

  const colCount = 3 + (canManage ? 1 : 0);

  return (
    <div className="h-full flex flex-col bg-background" data-testid="security-survey-page">
      <div className={cn(OPS_PAGE_SHELL, "pt-3 md:pt-6 shrink-0")}>
        <PageHero
          eyebrow="Site Survey"
          badge="Security"
          title="Security site surveys"
          description="Conduct structured site checklists, capture evidence with GPS, and share PDF reports with clients."
          emptyMessage="Start a survey from Conduct, or open Completed to review past reports."
          icon={ClipboardList}
          compact
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as TabId)}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList
          className={cn(
            "mx-4 sm:mx-6 lg:mx-8 xl:mx-10 mt-3 grid shrink-0 h-11",
            colCount === 3 && "grid-cols-3",
            colCount === 4 && "grid-cols-4",
          )}
        >
          <TabsTrigger value="conduct" className="gap-1.5 text-xs sm:text-sm">
            <CheckSquare className="h-3.5 w-3.5" />
            Conduct
          </TabsTrigger>
          <TabsTrigger value="findings" className="gap-1.5 text-xs sm:text-sm">
            <BookOpen className="h-3.5 w-3.5" />
            Findings
          </TabsTrigger>
          {canManage && (
            <TabsTrigger value="library" className="gap-1.5 text-xs sm:text-sm">
              <Library className="h-3.5 w-3.5" />
              Library
            </TabsTrigger>
          )}
          <TabsTrigger value="completed" className="gap-1.5 text-xs sm:text-sm">
            <ClipboardList className="h-3.5 w-3.5" />
            Completed
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="conduct"
          className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden"
        >
          <div className={cn(OPS_PAGE_SHELL, "py-4 pb-10")}>
            <SurveyConduct
              onOpenFindings={(id) => {
                setFocusSurveyId(id);
                setTab("completed");
              }}
            />
          </div>
        </TabsContent>

        <TabsContent
          value="findings"
          className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden"
        >
          <div className={cn(OPS_PAGE_SHELL, "py-4 pb-10")}>
            <SurveyFindings />
          </div>
        </TabsContent>

        {canManage && (
          <TabsContent
            value="library"
            className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden"
          >
            <div className={cn(OPS_PAGE_SHELL, "py-4 pb-10")}>
              <SurveyLibrary />
            </div>
          </TabsContent>
        )}

        <TabsContent
          value="completed"
          className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden"
        >
          <div className={cn(OPS_PAGE_SHELL, "py-4 pb-10")}>
            <SurveyCompleted canArchive={canManage} initialSurveyId={focusSurveyId} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
