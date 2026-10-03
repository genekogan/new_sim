# Option diagrams for the questions page: python3 docs/engineering/questions/tools/diagrams.py
# writes docs/engineering/questions/diagrams/*.svg (labelled SVGs used where an option cannot be staged in the lab).
import os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','diagrams')
BEAM='#e0661b'; POST='#1d2a44'; PLY='#e2c48d'; JOIST='#b07a3c'; SAND='#e8d9b5'; INK='#1a1a1a'; RED='#d62020'
def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" font-family="system-ui,-apple-system,Helvetica,sans-serif" font-size="15"><rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>'
def t(x,y,s,size=15,w='400',anchor='middle',fill=INK): return f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{w}" text-anchor="{anchor}" fill="{fill}">{s}</text>'
def r(x,y,w,h,fill,stroke=INK,sw=1.5): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
def title(x,s): return t(x,28,s,16,'700')
def save(name,w,h,body):
    open(os.path.join(OUT,name),'w').write(svg(w,h,body)); print(name)

# Q9 decks: three options, end view (looking along the beams), two beams per panel
def beams(ox, y=150, gap=200):
    return r(ox,y,24,34,BEAM)+r(ox+gap,y,24,34,BEAM)+t(ox+12,y+56,'beam',13)+t(ox+gap+12,y+56,'beam',13)
b=''
b+=title(150,'A. Strips lie on top of the beams')+beams(40)+r(30,136,244,14,PLY)+t(150,120,'plywood strip',13)
b+=title(450,'B. Sheets sit in a ledge on the beams')+beams(340)+r(364,150,176,12,PLY)+r(340,162,24,6,BEAM)+r(516,162,24,6,BEAM)+t(450,120,'sheet flush with beam top',13)+t(450,238,'(a step / ledge along each beam)',12)
b+=title(760,'C. 4x8 sheets on 2x4 joists')+beams(650)+''.join(r(664+i*42,112,12,38,JOIST) for i in range(5))+r(640,98,244,14,PLY)+t(760,88,'plywood sheet',13)+t(760,238,'2x4 joists across the beams, every ~2 ft',12)
save('q09-deck-options.svg',900,256,b)

# Q8 span: side view of one bay 4 ft deep
b=title(215,'A. Plywood straight on beams 4 ft apart')+r(60,150,26,34,BEAM)+r(344,150,26,34,BEAM)+r(50,136,330,14,PLY)+f'<line x1="73" y1="200" x2="357" y2="200" stroke="{RED}" stroke-width="2"/>'+t(215,222,'4 ft with nothing underneath',13,'600',fill=RED)
b+=title(665,'B. Joists every 2 ft under the plywood')+r(510,150,26,34,BEAM)+r(794,150,26,34,BEAM)+''.join(r(x,110,12,40,JOIST) for x in (523,592,661,730,799))+r(500,96,330,14,PLY)+t(665,222,'no more than 2 ft between supports',13,'600')
save('q08-span-options.svg',880,240,b)

# Q10: a 15 ft strip seen from above, beams (joint lines) across it
def strip(ox,oy,parts,labels):
    s=''; x=ox; scale=40
    for p,l in zip(parts,labels):
        s+=r(x,oy,p*scale,60,PLY)+t(x+p*scale/2,oy+36,l,14,'600'); x+=p*scale
    return s
b=title(320,'A. What the model does now: 6 ft + 6 ft + 3 ft, joined over beams')+strip(20,50,[6,6,3],['6 ft','6 ft','3 ft'])
b+=t(320,150,'B. For example 8 ft + 7 ft, with blocking under the joint',16,'700')+strip(20,172,[8,7],['8 ft','7 ft'])+r(20+8*40-8,240,16,14,JOIST)+t(20+8*40,275,'blocking',12)
save('q10-strip-options.svg',660,290,b)

# Q11: plan view of a wall at a frame line
def plan(ox,outside):
    s=r(ox,110,260,10,BEAM,sw=1)+t(ox+130,104 if outside else 138,'beam line',13)
    s+=''.join(r(ox+x,100,16,30,POST) for x in (0,244))
    y=132 if outside else 88
    s+=r(ox,y,260,8,PLY)+t(ox+130,y+26 if outside else y-8,'wall panel',13,'600')
    s+=t(ox+130,190,'outside ↓   (plan view, from above)   inside ↑',11)
    return s
b=title(160,'A. Panels outside the beams (model now)')+plan(30,True)+title(480,'B. Panels inside the beams')+plan(350,False)
save('q11-wall-options.svg',640,210,b)

# Q12 stair, front view looking up the stair: treads with 2 or 4 stringers
def stair(ox,n):
    s=''
    for i in range(4): s+=r(ox,160-i*28,240,8,PLY)
    xs=[ox+6,ox+222] if n==2 else [ox+6,ox+76,ox+146,ox+222]
    s+=''.join(r(x,70,12,110,JOIST) for x in xs)
    return s
b=title(150,'A. Two side boards (stringers)')+stair(30,2)+t(150,205,'treads span the full 4.45 m',13)
b+=title(470,'B. Four stringers')+stair(350,4)+t(470,205,'extra support under the middle',13)
b+=title(770,'C. A ramp, not a stair')+f'<polygon points="660,180 880,180 880,80" fill="{PLY}" stroke="{INK}" stroke-width="1.5"/>'+t(770,205,'(write the details in the box)',13)
save('q12-stair-options.svg',900,220,b)

# Q13 solar: side view above the roof
def roof(ox): return r(ox,170,260,10,PLY)+t(ox+130,200,'roof deck',12)
b=title(160,'A. Modules on two rails (model now)')+roof(30)+''.join(r(x,110,12,60,POST) for x in (60,250))+f'<polygon points="40,110 280,70 282,80 42,120" fill="#233b6e" stroke="{INK}"/>'+r(50,102,240,5,'#9aa',sw=1)+r(50,88,240,5,'#9aa',sw=1)+t(160,58,'2 metal rails under the modules',13)
b+=title(480,'B. A wooden or metal frame under them')+roof(350)+''.join(r(x,100,10,70,JOIST) for x in (370,440,510,580))+r(362,96,236,8,JOIST)+f'<polygon points="360,96 600,60 602,70 362,106" fill="#233b6e" stroke="{INK}"/>'+t(480,48,'a frame / table of lumber',13)
save('q13-solar-options.svg',640,220,b)

# Q19 roof framing
b=title(170,'A. Sheets straight on the top beams (model)')+r(40,120,26,34,BEAM)+r(274,120,26,34,BEAM)+r(30,106,280,14,PLY)
b+=title(510,'B. 2x4 framing first, then the sheets')+r(380,130,26,34,BEAM)+r(614,130,26,34,BEAM)+r(376,118,268,12,JOIST)+''.join(r(x,94,10,24,JOIST) for x in (400,460,520,580,630))+r(370,80,280,14,PLY)+t(510,190,'roof ends up ~13 cm higher',13)
save('q19-roof-options.svg',680,210,b)

# Q4 ground level
def post(ox,gap):
    s=r(ox,170,300,40,SAND,stroke='none')+f'<line x1="{ox}" y1="170" x2="{ox+300}" y2="170" stroke="{INK}" stroke-width="2"/>'+t(ox+150,200,'sand',13)
    s+=r(ox+130,40,20,130-gap,POST)+r(ox+150,140-gap,110,10,BEAM)+t(ox+205,132-gap,'lowest beam',12)
    return s
b=title(170,'A. Post feet on the sand')+post(20,0)
b+=title(510,'B. Post feet 16 cm above the drawn sand')+post(360,16)+f'<line x1="480" y1="154" x2="480" y2="170" stroke="{RED}" stroke-width="3"/>'+t(420,166,'16 cm',13,'700',fill=RED)
save('q04-ground-options.svg',680,220,b)
