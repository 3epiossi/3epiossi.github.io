#!/bin/bash
# 黑白棋測驗分 4 份同時跑，加總：bash five/tests/obench-run.sh <標籤> <othello-bench.js 的參數…>
cd "$(dirname "$0")/../.."
tag=$1; shift
for p in 0 1 2 3; do node five/tests/othello-bench.js --part $p/4 "$@" > /tmp/obench-$tag-$p.json 2>/dev/null & done; wait
cat /tmp/obench-$tag-{0,1,2,3}.json | node -e '
const L=require("fs").readFileSync(0,"utf8").trim().split("\n").map(JSON.parse);
const s=(k)=>L.reduce((a,x)=>a+x[k],0), n=s("n");
const by={}; for(const x of L) for(const [k,[c,t]] of Object.entries(x.byE)){by[k]=by[k]||[0,0];by[k][0]+=c;by[k][1]+=t;}
console.log(process.argv[1].padEnd(14), "平均損失", (s("loss")/n).toFixed(2), "最佳步", (100*s("best")/n).toFixed(0)+"%", "深度", (s("depth")/n).toFixed(1), Object.entries(by).map(([k,[c,t]])=>k+":"+(t/c).toFixed(2)).join(" "));
' "$tag"
