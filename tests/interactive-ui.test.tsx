import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { I18nProvider } from "../components/i18n-provider";
import { ProblemPackageDraftEditor } from "../components/problem-package-draft-editor";
import { ProblemSamplesSection } from "../components/problem-samples-section";
import { InteractionLog } from "../components/interaction-log";

test("interactive author UI, samples and private logs render in Japanese and English", () => {
  for (const locale of ["ja","en"] as const) {
    const html=renderToStaticMarkup(<AppRouterContext.Provider value={{bfcacheId:"interactive",back(){},forward(){},push(){},replace(){},refresh(){},prefetch(){}}}><I18nProvider initialLocale={locale}>
      <ProblemPackageDraftEditor draft={{sourceLabel:"guess",checkerType:"interactive",checkerLanguage:"python",checkerSourceCode:"",compareMode:"exact",zipSizeBytes:0,fileCount:0,warnings:[],samples:[{id:"s",name:"sample01",input:"",output:"",description:"",interaction:"< 1000\n> ! 37"}],groups:[{id:"g",name:"group1",score:null,tests:[{id:"c",name:"case01",input:"37",output:""}]}]}} onChange={()=>{}} />
      <ProblemSamplesSection initialSamples={[{name:"sample01",input:"",output:"",description:"Explanation",interaction:"< 1000\n> ! 37"}]} samplePairCount={1}/>
      <InteractionLog text={"<script>private</script>"}/>
    </I18nProvider></AppRouterContext.Provider>);
    assert.match(html,/value="interactive" selected/);
    assert.ok(html.includes('value="5000"'));
    assert.ok(!html.includes('Sample Output'));
    assert.ok(html.includes('&lt;script&gt;private&lt;/script&gt;'));
    assert.ok(html.includes(locale==='ja'?'対話例':'Sample Interaction'));
  }
});
