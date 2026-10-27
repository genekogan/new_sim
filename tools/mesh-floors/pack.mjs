// Runtime-only tuples. Keep extraction provenance in the full manifest; intern
// identical surfaces/links across asset revisions without rounding coordinates.
export function packFloors(manifest) {
 const tags=[],surfaces=[],links=[],assets={},intern=(pool,value)=>{const key=JSON.stringify(value),i=pool.findIndex(v=>JSON.stringify(v)===key);if(i>=0)return i;pool.push(value);return pool.length-1;};
 for(const [hash,r] of Object.entries(manifest.assets)) {
  const si=r.surfaces.map(s=>{
   const [a,b,c,d]=s.polygon;
   if(s.polygon.length!==4||b[0]!==c[0]||b[1]!==a[1]||d[0]!==a[0]||d[1]!==c[1])throw Error('runtime packing requires axis-aligned rectangles');
   const prefix=s.tag.slice(0,s.tag.lastIndexOf(':',s.tag.lastIndexOf(':')-1)),suffix=s.tag.slice(prefix.length+1);
   return intern(surfaces,[s.level,s.y,...a,...c,`${intern(tags,prefix)}:${suffix}`]);
  });
  const li=(r.links??[]).map(l=>{if(l.kind!=='stairs'||l.path.length!==2)throw Error('runtime packing requires two-point stairs');return intern(links,[l.id,l.from,l.to,...l.path[0],...l.path[1],l.width,l.y0,l.y1]);});
  assets[hash]=[r.fitAxis,r.box[r.fitAxis],si,li];
 }
 return {tags,surfaces,links,assets};
}
