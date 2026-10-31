import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { I18nProvider } from "../components/i18n-provider";
import { DraftRecovery } from "../components/draft-recovery";
import { ProblemFilters } from "../components/problem-filters";
import { ProblemStudy } from "../components/problem-study";

test("recovery, discovery and private study forms render safely in both locales",()=>{
  for(const locale of ["ja","en"] as const){
    const html=renderToStaticMarkup(<AppRouterContext.Provider value={{bfcacheId:"workspace",back(){},forward(){},push(){},replace(){},refresh(){},prefetch(){}}}>
      <I18nProvider initialLocale={locale}>
        <DraftRecovery draft={{pending:{key:"u:p",owner:"u",writer:"a",updatedAt:1,base:"old",data:{}},message:"",stale:true,restore(){},async discard(){},async clear(){}}}/>
        <ProblemFilters loggedIn={false} filters={{q:"graph",tag:"dp"}} tags={["dp","グラフ"]}/>
        <ProblemStudy problemId="p1" initial={{bookmarked:true,review:true,notes:"<secret>",reviewAt:"2026-10-30T15:00:00.000Z"}}/>
      </I18nProvider>
    </AppRouterContext.Provider>);
    assert.ok(html.includes('value="graph"'));assert.ok(html.includes('value="2026-10-31"'));
    assert.ok(html.includes('&lt;secret&gt;'));assert.ok(!html.includes('<secret>'));
    assert.ok(html.includes(locale==="ja"?"下書きを復元":"Restore Draft"));
  }
});
