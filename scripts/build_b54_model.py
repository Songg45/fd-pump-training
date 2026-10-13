"""Reproducible photo-informed B54 model. Run with Blender background --python.
Geometry is an approximation, not an engineering drawing. No source photos embedded.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector, Matrix
PUMP_BAY_WIDTH_M=.88  # Approximate: flush pump face plus right-side walkway.
PUMP_FACE_HEIGHT_M=1.08
PUMP_FACE_BOTTOM_M=1.02
REAR_BAY_OPENING_M=1.26
PUMP_RECESS_M=0.0  # User-confirmed: the pump face is NOT recessed.
TOP_TOOLBOX_CENTER_Y=-1.63
TOP_TOOLBOX_LENGTH_M=3.02
TOP_TOOLBOX_FRONT_Y=TOP_TOOLBOX_CENTER_Y+TOP_TOOLBOX_LENGTH_M/2
TOP_TOOLBOX_REAR_Y=TOP_TOOLBOX_CENTER_Y-TOP_TOOLBOX_LENGTH_M/2
WALKWAY_DEPTH_M=TOP_TOOLBOX_FRONT_Y-(-3.22)  # Continues to full toolbox front.
WALKWAY_CENTER_Y=(-3.22+TOP_TOOLBOX_FRONT_Y)/2
PUMP_CENTER_X=-REAR_BAY_OPENING_M/2+PUMP_BAY_WIDTH_M/2
WALKWAY_WIDTH_M=REAR_BAY_OPENING_M-PUMP_BAY_WIDTH_M
WALKWAY_LEFT_X=PUMP_CENTER_X+PUMP_BAY_WIDTH_M/2
WALKWAY_CENTER_X=WALKWAY_LEFT_X+WALKWAY_WIDTH_M/2
BOOSTER_PAYOUT_DIRECTION=(-1,0,0)  # Exported world direction: left from rear.
WALKWAY_TOP_M=1.0
PUMP_ROW_FACTOR=PUMP_FACE_HEIGHT_M/1.62
PUMP_LAYOUT_REFERENCE_WIDTH_M=2.09
PUMP_LAYOUT_FACTOR=PUMP_BAY_WIDTH_M/PUMP_LAYOUT_REFERENCE_WIDTH_M
FACE_ANCHORS={}
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/models'; OUT.mkdir(parents=True,exist_ok=True)
(ROOT/'models').mkdir(exist_ok=True)
QA=ROOT/'.qa/b54'; QA.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(54)
def mat(n,c,metal=0,rough=.4):
 m=bpy.data.materials.new(n); m.diffuse_color=(*c,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 return m
red=mat('B54 fire red',(.56,.013,.025),.35,.27); chrome=mat('Brushed aluminum',(.53,.59,.65),.8,.3); silver=mat('Bright chrome',(.75,.8,.86),.85,.2)
black=mat('Rubber and black control plates',(.013,.018,.023),.08,.55); glass=mat('Blue gray windows',(.055,.12,.16),.55,.18)
white=mat('Ivory markings',(.89,.9,.84)); gold=mat('Department gold',(.95,.64,.12),.4); blue=mat('Discharge blue',(.025,.065,.28),.2)
green=mat('Hose reel green',(.02,.31,.16)); pink=mat('Suction magenta',(.37,.08,.21)); tan=mat('Canvas hose',(.47,.42,.3),0,.9); amber=mat('Amber lamps',(1,.24,.014)); darkred=mat('Red lenses',(.65,.02,.02),.2); gray=mat('Gauge face',(.8,.82,.75)); yellow=mat('Tool yellow',(.82,.59,.025))
def finish(o,n,m,parent=None):
 o.name=n
 if m:o.data.materials.append(m)
 if parent:o.parent=parent
 return o
def box(n,loc,size,m,bevel=.015,parent=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  mod=o.modifiers.new('Rounded manufactured edges','BEVEL'); mod.width=bevel; mod.segments=2
  bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,n,m,parent)
def cyl(n,loc,r,d,m,axis='Y',parent=None,verts=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=d,location=loc); o=bpy.context.object
 o.rotation_euler=({'X':(0,math.pi/2,0),'Y':(math.pi/2,0,0),'Z':(0,0,0)})[axis]
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
 for p in o.data.polygons:p.use_smooth=True
 if axis=='Y':FACE_ANCHORS[o]=loc[2]
 return finish(o,n,m,parent)
def sphere(n,loc,r,m,parent=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=r,location=loc); FACE_ANCHORS[bpy.context.object]=loc[2]; return finish(bpy.context.object,n,m,parent)
def pipe(n,points,r,m,parent=None):
 c=bpy.data.curves.new(n,'CURVE'); c.dimensions='3D'; c.resolution_u=1; c.bevel_depth=r; c.bevel_resolution=2
 s=c.splines.new('POLY'); s.points.add(len(points)-1)
 for p,v in zip(s.points,points):p.co=(*v,1)
 o=bpy.data.objects.new(n,c); bpy.context.collection.objects.link(o); finish(o,n,m,parent)
 bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o.select_set(False); FACE_ANCHORS[o]=sum(p[2] for p in points)/len(points); return o
def text(n,body,loc,size,m=white,rot=(math.pi/2,0,0),parent=None):
 c=bpy.data.curves.new(n,'FONT'); c.body=body; c.align_x='CENTER'; c.align_y='CENTER'; c.size=size; c.extrude=.00035; c.resolution_u=3
 o=bpy.data.objects.new(n,c); bpy.context.collection.objects.link(o); o.location=loc; o.rotation_euler=rot; finish(o,n,m,parent)
 bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o; bpy.ops.object.convert(target='MESH'); o.select_set(False); FACE_ANCHORS[o]=loc[2]; return o
def label(n,body,x,z,w=.25,h=.052,color=black,y=-3.23,size=.019,parent=None):
 FACE_ANCHORS[box(n+'_rim',(x,y+.004,z),(w+.009,.011,h+.009),chrome,.005,parent)]=z
 FACE_ANCHORS[box(n+'_plate',(x,y-.004,z),(w,.008,h),color,.003,parent)]=z
 text(n+'_text',body,(x,y-.01,z),size,black if color in (tan,chrome,white) else white,parent=parent)
def mesh(n,vs,fs,m):
 me=bpy.data.meshes.new(n); me.from_pydata(vs,[],fs); me.update(); o=bpy.data.objects.new(n,me); bpy.context.collection.objects.link(o); return finish(o,n,m)
def sidepoly(n,side,yz,m,x=1.015):
 return mesh(n,[(side*x,y,z) for y,z in yz],[(0,1,2,3)],m)
# Chassis, long compartment body, cab and tapered hood.
box('Frame',(0,0,.59),(1.6,6.2,.22),black)
box('Bed upper body',((WALKWAY_LEFT_X-1.08)/2,-1.29,1.63),(WALKWAY_LEFT_X+1.08,2.16,.94),red)
box('Right compartment body',((REAR_BAY_OPENING_M/2+1.08)/2,-1.29,1.63),(1.08-REAR_BAY_OPENING_M/2,2.16,.94),red)
box('Bed floor',(0,-1.29,.91),(2.13,2.16,.11),chrome)
for s in [-1,1]:
 for cy,ln in [(-2.65,.96),(-.55,.86)]:box('Lower side cabinet',(s*.88,cy,.89),(.39,ln,.52),red)
 box('Rear corner trim',(s*1.086,-3.12,1.65),(.075,.1,1.33),chrome)
 box('Forward body trim',(s*1.086,-.24,1.66),(.07,.12,1.35),chrome)
 box('Upper tool box',(s*.88,TOP_TOOLBOX_CENTER_Y,2.32),(.42,TOP_TOOLBOX_LENGTH_M,.32),chrome)
 for i,cy in enumerate([-.73,-1.68,-2.63]):
  box('Compartment door seam',(s*1.087,cy,1.7),(.018,.91,.84),black,.008)
  box('Compartment red door',(s*1.101,cy,1.71),(.017,.875,.807),red,.006)
  cyl('Chrome compartment latch',(s*1.126,cy,1.38),.066,.035,silver,'X')
  box('Door latch grip',(s*1.151,cy,1.38),(.018,.08,.018),black,.004)
  box('White body stripe',(s*1.115,cy,1.47),(.012,.875,.12),white,.001)
  for z in [1.395,1.548]:box('Blue stripe border',(s*1.124,cy,z),(.009,.877,.014),blue,.001)
 box('Bed lower trim',(s*1.09,-1.66,.645),(.065,2.98,.06),chrome)
 # Chrome arch follows top of rear tire.
 pipe('Rear wheel arch',[(s*1.13,-1.68+.59*math.cos(a),.59+.59*math.sin(a)) for a in [i*math.pi/24 for i in range(25)]],.045,chrome)
box('Cab lower',(0,1.02,1.12),(1.94,2.34,.63),red,.06)
# Cab upper shaped wedge with raked windshield.
vs=[(x,y,z) for x in [-.97,.97] for y,z in [(-.15,1.4),(-.12,2.29),(1.38,2.29),(2.09,1.43)]]
mesh('Extended cab shell',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(0,3,7,4)],red)
mesh('Wide windshield',[(-.86,1.43,2.23),(.86,1.43,2.23),(.9,2.045,1.5),(-.9,2.045,1.5)],[(0,1,2,3)],glass)
box('Cab roof',(0,.62,2.3),(1.95,1.56,.09),red,.045)
box('Hood',(0,2.62,1.38),(1.94,1.15,.46),red,.09)
for s in [-1,1]:
 sidepoly('Front side window',s,[(.55,1.54),(.55,2.2),(1.35,2.2),(1.94,1.54)],glass,.979)
 sidepoly('Extended cab side window',s,[(-.06,1.53),(-.06,2.19),(.41,2.19),(.41,1.53)],glass,.979)
 box('Door vertical seam',(s*.979,.46,1.29),(.008,.014,1.16),black,.001)
 box('Door handle',(s*1.003,.59,1.32),(.035,.105,.17),black)
 box('Cab white stripe',(s*.982,1.05,.96),(.015,2.17,.1),white,.001)
 for z in [.891,1.025]:box('Cab blue stripe',(s*.988,1.05,z),(.01,2.17,.014),blue,.001)
 pipe('Running board rail',[(s*1.03,-.03,.67),(s*1.17,.14,.64),(s*1.17,1.62,.64),(s*1.03,1.8,.72)],.045,silver)
 box('Step tread',(s*1.17,.85,.685),(.19,1.35,.035),black)
 pipe('Mirror arm',[(s*.97,1.65,1.58),(s*1.31,1.55,1.65)],.035,black)
 box('Tow mirror',(s*1.35,1.48,1.81),(.19,.27,.4),black,.055)
 box('Mirror glass',(s*1.35,1.337,1.81),(.14,.014,.32),silver,.025)
 # Side markings use local text normal facing outward.
 rot=(math.pi/2,0,s*math.pi/2)
 text('PILOT door lettering','PILOT',(s*1.001,1.22,1.29),.19,gold,rot)
 text('FD door lettering','F  D',(s*1.002,1.2,1.08),.14,gold,rot)
 text('Unit hood marking','1154',(s*.985,2.44,1.47),.115,gold,rot)
 # Tires and tread blocks.
 for wy in [2.32,-1.68]:
  wx=s*(1.02 if wy>0 else 1.035)
  cyl('All terrain tire',(wx,wy,.55),.51,.33,black,'X',verts=48)
  cyl('Chrome wheel',(wx+s*.18,wy,.55),.31,.036,silver,'X')
  cyl('Wheel hub',(wx+s*.207,wy,.55),.12,.085,chrome,'X')
  for i in range(10):
   a=i*math.tau/10
   cyl('Wheel lug',(wx+s*.23,wy+.19*math.cos(a),.55+.19*math.sin(a)),.019,.024,chrome,'X',verts=8)
  for i in range(28):
   a=i*math.tau/28
   o=box('Tire tread',(wx,wy+.503*math.cos(a),.55+.503*math.sin(a)),(.35,.073,.035),black,.005); o.rotation_euler.x=a-math.pi/2
  pipe('Fender black arch',[(s*1.027,wy+.565*math.cos(a),.55+.565*math.sin(a)) for a in [i*math.pi/24 for i in range(25)]],.065,black)
box('Front chrome bumper',(0,3.23,.76),(2.1,.19,.3),silver,.04)
box('Front grille surround',(0,3.211,1.18),(1.92,.08,.52),chrome)
box('Grille dark inset',(0,3.266,1.2),(1.03,.018,.43),black)
for z in [1.03,1.19,1.35]:box('Grille bars',(0,3.28,z),(1.06,.045,.038),chrome)
for s in [-1,1]:
 for z in [1.08,1.33]:box('Headlamp',(s*.76,3.271,z),(.36,.055,.2),gray)
 box('Fog lamp surround',(s*.77,3.337,.76),(.3,.025,.19),black)
 cyl('Fog lamp',(s*.77,3.36,.76),.073,.025,gray)
for x in [-.65,-.33,0,.33,.65]:sphere('Amber roof marker',(x,1.21,2.37),.047,amber)
box('Roof lightbar mount',(0,.48,2.4),(1.58,.28,.055),black)
for x in [-.54,0,.54]:box('Emergency lightbar',(x,.48,2.48),(.5,.28,.14),darkred if x else white,.025)
for x in [-.58,.58]:pipe('Brush guard upright',[(x,3.47,.68),(x,3.51,1.57)],.047,black)
for z in [.98,1.43]:pipe('Brush guard full width rail',[(-1.08,3.41,z),(-.59,3.5,z),(0,3.51,z),(.59,3.5,z),(1.08,3.41,z)],.035,silver)
box('Winch tray',(0,3.48,.73),(1.12,.41,.22),black)
cyl('Winch cable drum',(0,3.49,.9),.087,.58,black,'X')
box('Winch fairlead',(0,3.706,.73),(.43,.045,.16),chrome)
box('Fairlead opening',(0,3.734,.73),(.27,.018,.075),black)
pipe('Winch hook strap',[(0,3.75,.75),(0,3.77,.48),(.045,3.77,.45)],.016,yellow)
pipe('Front bumper nozzle riser',[(-.66,3.56,.68),(-.74,3.56,.87),(-.74,3.56,1.72),(-.92,3.57,1.8),(-1.03,3.65,1.67)],.047,red)
cyl('Bumper nozzle tip',(-1.03,3.69,1.65),.066,.17,black)
# Equipment on top: reel, hose beds and long tool boxes.
box('Hose bed deck',(PUMP_CENTER_X,-1.715,2.13),(PUMP_BAY_WIDTH_M,2.89,.055),chrome)
HOSE_DIVIDER_THICKNESS_M=.025
HOSE_BED_LEFT_X=PUMP_CENTER_X-PUMP_BAY_WIDTH_M/2
HOSE_BED_RIGHT_X=PUMP_CENTER_X+PUMP_BAY_WIDTH_M/2
divider_centers=[HOSE_BED_LEFT_X+HOSE_DIVIDER_THICKNESS_M/2+i*(PUMP_BAY_WIDTH_M-HOSE_DIVIDER_THICKNESS_M)/3 for i in range(4)]
for i,x in enumerate(divider_centers):box('Hose bed divider '+str(i),(x,-2.275,2.36),(HOSE_DIVIDER_THICKNESS_M,1.74,.45),chrome)
hose_lanes=[]
for bed in range(3):
 left=divider_centers[bed]+HOSE_DIVIDER_THICKNESS_M/2
 right=divider_centers[bed+1]-HOSE_DIVIDER_THICKNESS_M/2
 x=(left+right)/2; w=right-left-.016
 hose_lanes.append({'index':bed+1,'centerX':x,'clearBoundsX':[left,right],'stackWidth':w})
 for j in range(6):
  for k in range(2):
   box('Hose lane '+str(bed+1)+' canvas',(x+(random.random()-.5)*.004,-2.76+k*.74,2.18+j*.055),(w,.73,.054),tan,.025)
 cyl('Preconnect nozzle',(x,-1.68,2.52),.045,.19,black)
# Entire booster spool axis is fore/aft: winding plane X/Z, payout toward -X.
for y in [-.97,-.27]:cyl('Hose reel flange',(PUMP_CENTER_X,y,2.64),.37,.035,chrome,'Y',verts=48)
cyl('Reel hub',(PUMP_CENTER_X,-.62,2.64),.11,.8,chrome,'Y')
for y in [-1.01,-.23]:
 box('Booster reel bearing support',(PUMP_CENTER_X,y,2.41),(.13,.07,.44),chrome)
 box('Booster reel mounting foot',(PUMP_CENTER_X,y,2.21),(.55,.13,.05),chrome)
for j in range(11):
 y=-.92+j*.06
 pipe('Reel wound hose',[(PUMP_CENTER_X+.305*math.cos(i*math.tau/64),y,2.64+.305*math.sin(i*math.tau/64)) for i in range(65)],.027,black)
pipe('Booster left payout hose',[(PUMP_CENTER_X,-.62,2.945),(-.4,-.62,2.945),(-.79,-.62,2.85),(-1.04,-.62,2.63),(-1.12,-.62,2.47)],.027,black)
cyl('Booster left guide roller',(-.85,-.62,2.78),.037,.17,chrome,'Y')
box('Booster left guide bracket',(-.85,-.62,2.67),(.06,.23,.14),chrome)
cyl('Booster hose nozzle',(-1.12,-.62,2.42),.045,.15,black,'Z')
for s in [-1,1]:
 pipe('Top chrome rail',[(s*.99,-3,2.57),(s*.99,-.27,2.57)],.024,silver)
 for yy in [-2.92,-.35]:cyl('Top rail post',(s*.99,yy,2.5),.022,.16,chrome,'Z')
for i in range(4):
 x=.8+(i%2)*.07
 pipe('Stored long tool',[(x,-2.8,2.52+i*.028),(x,-.4,2.52+i*.028)],.018,yellow if i%2 else tan)
 box('Tool head',(x,-2.82,2.53+i*.028),(.16,.18,.025),black)
# User-confirmed rear: flush pump face on left, walkway only on its right.
face_y=-3.22+PUMP_RECESS_M
box('Pump housing',(PUMP_CENTER_X,-3.22+WALKWAY_DEPTH_M/2+.02,PUMP_FACE_BOTTOM_M+PUMP_FACE_HEIGHT_M/2),(PUMP_BAY_WIDTH_M-.025,WALKWAY_DEPTH_M-.04,PUMP_FACE_HEIGHT_M-.025),chrome)
box('Rear panel backing',(PUMP_CENTER_X,face_y+.06,PUMP_FACE_BOTTOM_M+PUMP_FACE_HEIGHT_M/2),(PUMP_BAY_WIDTH_M,.12,PUMP_FACE_HEIGHT_M),chrome)
tower_width=(2.16-REAR_BAY_OPENING_M)/2
for side in [-1,1]:
 x=side*(REAR_BAY_OPENING_M/2+tower_width/2)
 box('Rear red compartment tower',(x,-2.775,1.565),(tower_width,.81,1.61),red,.018)
 box('Rear tower end red face',(x,-3.20,1.565),(tower_width-.025,.04,1.61),red,.008)
 box('Rear tower aluminum cap',(x,-2.775,2.485),(tower_width,.81,.23),chrome,.012)
 if side==1:box('Right containers inner wall',(REAR_BAY_OPENING_M/2-.009,WALKWAY_CENTER_Y,1.715),(.018,WALKWAY_DEPTH_M,1.43),chrome,.004)
 box('Bay opening vertical trim',(side*(REAR_BAY_OPENING_M/2+.01),-3.232,1.565),(.031,.026,1.61),silver,.004)
 for z,color in [(2.24,white),(2.025,darkred),(1.095,amber),(.945,white),(.795,darkred)]:
  if side==1 and z>2:color=darkred if z==2.24 else white
  box('Rear tower lamp bezel',(x,-3.241,z),(.195,.035,.132),silver,.018)
  box('Rear tower lamp lens',(x,-3.265,z),(.162,.022,.10),color,.014)
 cyl('Rear tower small lamp',(x,-3.245,1.875),.028,.025,silver)
 box('Rear tower white stripe',(x,-3.231,1.50),(tower_width-.025,.016,.084),white,.001)
 for z in [1.446,1.554]:box('Rear tower blue stripe',(x,-3.242,z),(tower_width-.025,.007,.009),blue,.001)
 if side==1:text('Rear unit marking','1154',(x,-3.24,1.685),.11,chrome)
 else:label('Rear plate','B54',x,1.695,.25,.115,tan,y=-3.24,size=.053)
 for col in range(9 if side==1 else 0):
  for row in range(15):
   o=box('Inner wall diamond',(side*(REAR_BAY_OPENING_M/2-.023),-3.17+col*.083,1.06+row*.09),(.006,.038,.011),silver,.002); o.rotation_euler.x=(-1 if (col+row)%2 else 1)*.7
box('Pump right side wall',(WALKWAY_LEFT_X-.009,WALKWAY_CENTER_Y,1.715),(.018,WALKWAY_DEPTH_M,1.43),chrome,.004)
box('Walkway forward end wall',(WALKWAY_CENTER_X,-3.22+WALKWAY_DEPTH_M+.014,1.715),(WALKWAY_WIDTH_M,.028,1.43),chrome,.004)
box('Walkway deck',(WALKWAY_CENTER_X,-3.22+WALKWAY_DEPTH_M/2,WALKWAY_TOP_M-.035),(WALKWAY_WIDTH_M,WALKWAY_DEPTH_M,.07),chrome,.006)
box('Walkway rear threshold',(WALKWAY_CENTER_X,-3.235,WALKWAY_TOP_M),(WALKWAY_WIDTH_M,.035,.025),silver,.004)
for ix in range(5):
 for iy in range(int(WALKWAY_DEPTH_M/.074)):
  o=box('Walkway diamond',(WALKWAY_LEFT_X+.035+ix*(WALKWAY_WIDTH_M-.07)/4,-3.18+iy*.074,WALKWAY_TOP_M+.003),(.042,.011,.004),silver,.002); o.rotation_euler.z=(-1 if (ix+iy)%2 else 1)*.7
box('Rear lower storage door',(0,-3.18,.825),(REAR_BAY_OPENING_M-.025,.08,.30),chrome,.008)
for col in range(17):
 x=-.59+col*.074
 if abs(x)<.23:continue
 for row in range(3):
  o=box('Rear access face diamond',(x,-3.225,.72+row*.08),(.04,.005,.01),silver,.002); o.rotation_euler.y=(-1 if (col+row)%2 else 1)*.7
for x in [-.145,0,.145]:
 box('Rear center marker rim',(x,-3.231,.90),(.098,.02,.042),silver,.008)
 box('Rear center marker red',(x,-3.247,.90),(.065,.016,.03),darkred,.005)
cyl('Rear compartment latch',(0,-3.24,.775),.067,.035,chrome)
box('Rear compartment latch grip',(0,-3.266,.775),(.087,.02,.015),black)
box('Rear step',(0,-3.30,.655),(2.25,.25,.075),chrome)
for ix in range(31):
 for iy in range(3):
  o=box('Step diamond',(-1.075+ix*.071,-3.395+iy*.075,.696),(.043,.01,.004),silver,.002); o.rotation_euler.z=(-1 if (ix+iy)%2 else 1)*.7
box('Rear hose cubby opening',(-.855,-3.187,2.49),(.34,.015,.16),black,.004)
for row in range(3):
 for col in range(2):box('Cubby folded blue hose',(-.945+col*.15,-3.205,2.437+row*.044),(.137,.065,.039),blue,.018)
for x in [PUMP_CENTER_X-.97*PUMP_LAYOUT_FACTOR,PUMP_CENTER_X+.97*PUMP_LAYOUT_FACTOR]:
 for z in [.88,1.2,1.6,2.19]:cyl('Panel fastener',(x,face_y-.012,PUMP_FACE_BOTTOM_M+(z-.63)*PUMP_ROW_FACTOR),.007,.008,silver,verts=8)
# Panel dimensions and labels follow the photographed layout.
panel_before=set(bpy.data.objects)
box('Waterous instrument plate',(-.59,-3.235,1.947),(.69,.022,.48),black,.018)
def gauge(n,x,z,r=.087,tach=False):
 before=set(bpy.data.objects)
 cyl(n+'_bezel',(x,-3.263,z),r,.033,silver)
 cyl(n+'_face',(x,-3.284,z),r*.88,.011,black if tach else gray)
 for i in range(31):
  a=math.radians(225-i*9)
  r1=r*(.7 if i%5==0 else .77); r2=r*.83
  pipe(n+'_tick',[(x+r1*math.cos(a),-3.293,z+r1*math.sin(a)),(x+r2*math.cos(a),-3.293,z+r2*math.sin(a))],.0009,white if tach else black)
 for i in range(7):
  a=math.radians(225-i*45)
  text(n+'_number',str(i*5 if tach else i*100),(x+r*.55*math.cos(a),-3.295,z+r*.55*math.sin(a)),r*.14,white if tach else black)
 pipe(n+'_needle',[(x-r*.18,-3.299,z-r*.17),(x+r*.48,-3.299,z+r*.46)],.0025,white if tach else black)
 cyl(n+'_center',(x,-3.302,z),r*.055,.008,chrome)
 text(n+'_units','RPM x100' if tach else 'PSI',(x,-3.295,z-r*.33),r*.13,white if tach else black)
 # Scale the entire gauge about its center, keeping face/ticks/text circular.
 for o in set(bpy.data.objects)-before:FACE_ANCHORS[o]=z
for n,x in [('Intake',-.83),('Pressure',-.6),('Tachometer',-.37)]:gauge(n,x,2.08,.091,n=='Tachometer')
label('Waterous_brand','WATEROUS',-.72,1.755,.26,.039,black,y=-3.27,size=.027)
label('Water_label','WATER',-.115,2.24,.17,.035,blue,size=.021)
box('Water level blue frame',(-.115,-3.261,2.073),(.16,.045,.26),blue)
box('Water level white inset',(-.115,-3.288,2.073),(.095,.009,.228),white)
box('Water level sight tube',(-.105,-3.299,2.073),(.03,.018,.201),glass)
for z,t in [(2.16,'F'),(2.10,'3/4'),(2.04,'1/2'),(1.98,'1/4')]:text('Water_level_tick',t,(-.142,-3.301,z),.015,black)
label('Foam_label','FOAM',.2,2.24,.14,.035,red,size=.02)
box('Foam level metal plate',(.2,-3.257,2.07),(.12,.022,.27),silver)
for z in [2.155,2.1,2.045,1.99]:
 cyl('Foam level LED surround',(.2,-3.276,z),.021,.014,black)
 cyl('Foam level amber LED',(.2,-3.287,z),.013,.009,amber)
for x,z in [(-.61,1.92),(-.45,1.92),(-.45,1.85)]:cyl('Static instrument button',(x,-3.28,z),.023,.025,darkred if x==-.61 else black)
text('Emergency stop caption','EMERGENCY STOP',(-.62,-3.3,1.96),.013)
for x in [-.345,-.265]:
 for z in [1.925,1.865]:box('Engine status lamp',(x,-3.258,z),(.062,.01,.044),darkred if z>1.9 else amber,.003)
label('EVS_brand','ANCHOR-RICHEY',.65,2.13,.49,.05,chrome,size=.029)
text('EVS_letters','EVS',(.65,-3.252,2.035),.135,red)
text('EVS_phone','1-800-754-7186',(.65,-3.254,1.952),.029,black)
for x,z in [(.45,1.84),(.45,1.42),(.45,1.035)]:gauge('Discharge pressure',x,z,.089)
label('Work_lights','BACK UP / WORK LIGHTS',.83,2.255,.3,.05,black,size=.016)
# Animation roots are identity transform empties. Children have local offsets.
controls=[]
def root(n,x,z,y=-3.29):
 o=bpy.data.objects.new(n,None); bpy.context.collection.objects.link(o); o.location=(x,y,z); o['controlId']=n.removeprefix('ctrl_'); o['interactive']=True; return o
def handle(cid,title,x,z,col,reverse=False,inactive=False):
 cyl(cid+'_socket',(x,-3.255,z),.036,.033,silver)
 r=root('ctrl_'+cid,x,z); r['interactive']=not inactive
 # Shaft extends 0.66 m behind face so it remains connected throughout travel.
 cyl(cid+'_shaft',(0,.3,0),.011,.66,silver,parent=r)
 box(cid+'_grip',(0,-.022,0),(.202,.05,.052),silver,.012,r)
 label(cid,title,0,0,.185,.042,col,y=-.053,size=.015,parent=r)
 d={'id':cid,'node':r.name,'label':title.replace('\n',' '),'type':'pushPullLock','enabled':not inactive,'positionAxis':[0,0,1],'positionRange':[0,.6],'neutral':0,'endpoints':[{'value':0,'state':'open' if reverse else 'disengaged / closed'},{'value':.6,'state':'closed' if reverse else 'engaged / open'}],'lock':{'rotationNode':r.name,'axis':[0,0,1],'unlockedAngle':0,'lockedAngle':math.pi/2,'initialLocked':False,'blocks':'all axial displacement; preserve exact extension while locked','turnToUnlockBeforeAxialMotion':True},'travelStatus':'provisional approximately arm length; not measured','behaviorStatus':'reverse mapping confirmed; lock/travel unconfirmed' if reverse else 'user confirmed push/pull and positive lock'}
 if inactive:d.update(type='inactive',behaviorStatus='HALE PRIME has not been operated by user; interaction must remain disabled')
 controls.append(d)
for a in [('tank_fill','TANK FILL\nRECIRCULATE',.46,2.21,black),('hose_reel','HOSE REEL',.83,1.825,green),('right_preconnect','RIGHT 1 1/2\nPRECONNECT',.45,1.672,red),('discharge_1','1 IN DISCHARGE',.83,1.438,blue),('center_preconnect','CENTER 1 1/2\nPRECONNECT',.45,1.238,red),('discharge_2_5','2 1/2 DISCHARGE',.83,1.063,blue),('left_preconnect','LEFT 1 1/2\nPRECONNECT',.45,.841,tan)]:handle(*a)
handle('tank_valve','TANK VALVE\nPULL TO CLOSE',-.3,.772,blue,reverse=True)
handle('hale_prime','HALE',.065,1.269,blue,inactive=True)
label('Prime_caption','PRIME',.065,1.327,.12,.035,black,size=.022)
# Suction lever moves laterally between only two detents.
box('Suction slot surround',(-.59,-3.261,1.556),(.78,.041,.106),black,.048)
label('Suction_caption','CLOSE  <---   SUCTION   --->  OPEN',-.59,1.66,.61,.05,pink,size=.022)
r=root('ctrl_suction',-.94,1.556,-3.307)
pipe('Suction chrome lever',[(0,0,0),(.28,.012,.024)],.012,silver,r); sphere('Suction ball grip',(0,-.03,0),.042,black,r)
controls.append({'id':'suction','node':r.name,'label':'SUCTION','type':'twoStateSlider','enabled':True,'positionAxis':[1,0,0],'positionRange':[0,.69],'neutral':0,'endpoints':[{'value':0,'state':'CLOSED / left'},{'value':.69,'state':'OPEN / right'}],'snap':'always snap to nearest endpoint on release; no stable intermediate state','travelStatus':'visual estimate; behavior user confirmed'})
# Foam control centered on its horizontal track.
box('V Series foam panel',(.06,-3.251,1.755),(.43,.025,.15),black,.008)
text('Foam heading','V-Series Foam System',(.06,-3.274,1.805),.025)
box('Foam slider slot',(.06,-3.273,1.757),(.315,.012,.021),chrome,.008)
box('Foam slider dark slot',(.06,-3.282,1.757),(.3,.01,.009),black,.004)
text('Foam detent labels','PRIME        OFF        OPERATE',(.06,-3.29,1.713),.014)
r=root('ctrl_foam',.06,1.757,-3.304); box('Foam vertical grip',(0,0,0),(.025,.028,.082),black,.008,r)
controls.append({'id':'foam','node':r.name,'label':'V-Series Foam','type':'threeStateSliderLock','enabled':True,'positionAxis':[1,0,0],'positionRange':[-.139,.139],'neutral':0,'endpoints':[{'value':-.139,'state':'prime / far left'},{'value':0,'state':'off / center'},{'value':.139,'state':'operate / far right'}],'lock':{'rotationNode':r.name,'axis':[0,0,1],'unlockedAngle':0,'lockedAngle':math.pi/2,'initialLocked':False,'blocks':'all slider translation while locked; preserve exact position','turnToUnlockBeforeAxialMotion':True},'behaviorStatus':'user confirmed; turn angles are provisional'})
r=root('ctrl_throttle',-.37,1.784,-3.303); cyl('Throttle knurled grip',(0,0,0),.056,.055,black,parent=r); cyl('Throttle red face',(0,-.032,0),.045,.018,pink,parent=r)
box('Throttle orientation mark',(0,-.043,.032),(.007,.008,.017),white,.002,r)
text('Throttle_caption','THROTTLE',(-.37,-3.266,1.711),.018)
controls.append({'id':'throttle','node':r.name,'label':'THROTTLE','type':'rotary','enabled':True,'rotationAxis':[0,0,1],'rotationRange':[0,math.tau],'neutral':0,'positiveDirection':'counterclockwise as viewed from rear: turn left opens/increases','negativeDirection':'clockwise: turn right closes/decreases','boundsStatus':'one-turn visual range provisional; actual number of turns unknown'})
r=root('ctrl_engine_selector',-.56,1.777,-3.302); cyl('Selector base',(0,0,0),.035,.026,chrome,parent=r); box('Selector black grip',(0,-.023,0),(.022,.03,.073),black,.01,r)
text('Selector caption','OFF  RUN  START',(-.56,-3.268,1.829),.014)
controls.append({'id':'engine_selector','node':r.name,'label':'OFF / RUN / START','type':'threePositionRotary','enabled':True,'rotationAxis':[0,0,1],'rotationRange':[-.65,0],'neutral':0,'endpoints':[{'value':0,'state':'OFF'},{'value':-.325,'state':'RUN'},{'value':-.65,'state':'START'}],'springReturn':False,'boundsStatus':'visual selector angles provisional; plain three-position behavior user confirmed'})
# Visible suction fitting, capped discharges, safety label and static drains.
cyl('Suction flange',(-.61,-3.256,1.276),.132,.045,black)
cyl('Suction pipe',(-.61,-3.412,1.276),.102,.3,silver)
pipe('Suction elbow', [(-.61,-3.42,1.276),(-.61,-3.59,1.22),(-.61,-3.67,1.06)],.102,chrome)
cyl('Suction coupling rim',(-.61,-3.71,1.06),.128,.11,chrome)
cyl('Suction dark opening',(-.61,-3.774,1.06),.098,.005,black)
for x in [-.755,-.465]:box('Camlock coupling ear',(x,-3.709,1.08),(.042,.055,.1),chrome)
label('Safety_label','DO NOT\nSTAND ON\nVEHICLE\nWHEN IN\nMOTION',-.91,1.12,.145,.205,red,size=.022)
box('Diesel access rim',(-.77,-3.245,.855),(.34,.022,.245),black)
box('Diesel access door',(-.77,-3.263,.855),(.31,.021,.216),silver)
label('Diesel_label','DIESEL FUEL',-.79,1.0,.24,.03,black,size=.017)
for n,x,z,rad in [('1 inch discharge',.07,1.015,.044),('2.5 inch discharge',.83,.854,.11)]:
 cyl(n+' socket',(x,-3.27,z),rad*1.25,.07,black)
 cyl(n+' coupling',(x,-3.33,z),rad*1.08,.11,chrome)
 cyl(n+' blue cap',(x,-3.395,z),rad,.028,blue)
 cyl(n+' chain stud',(x,-3.417,z),.019,.022,chrome)
 for i in range(22):
  zz=z-i*.012; xx=x+.018*math.sin(i*.19); yy=-3.423+.016*math.sin(i*.32)
  sphere(n+' cap chain',(xx,yy,zz),.0058,silver)
for x,z,t in [(-.22,.963,'DRAIN'),(.58,.765,'DISCHARGE DRAIN')]:
 cyl('Static drain stem',(x,-3.276,z),.018,.07,chrome); sphere('Static drain knob',(x,-3.338,z),.034,black)
 label('Drain_label',t,x,z+(.068 if x<0 else -.06),.21,.029,pink,size=.013)
label('Pump_data_plate','WATEROUS\nFIRE PUMPS - SINCE 1886',.065,.86,.31,.12,tan,size=.019)
label('Foam_system_diagram','V-Series   HALE\nFOAM SYSTEM',.08,.708,.41,.09,black,size=.021)
for x,z in [(.185,1.6),(.185,1.48)]:cyl('Static foam power switch',(x,-3.259,z),.013,.022,black)
label('Foam_power','FOAM POWER',.185,1.535,.19,.035,pink,size=.018)
# Reflow panel rows into the left-offset flush face. Face assemblies resize
# equally in X/Z about each relocated row center; plates follow row spacing.
# Bake geometry so dials/lettering retain proportions and roots stay identity.
bpy.context.view_layer.update()
panel_objects=set(bpy.data.objects)-panel_before
old_world={o:o.matrix_world.copy() for o in panel_objects}
for o in panel_objects:
 if o.type=='EMPTY':
  o.location.x=o.location.x*PUMP_LAYOUT_FACTOR+PUMP_CENTER_X
  o.location.y+=PUMP_RECESS_M
  o.location.z=PUMP_FACE_BOTTOM_M+(o.location.z-.63)*PUMP_ROW_FACTOR
bpy.context.view_layer.update()
for o in panel_objects:
 if o.type!='MESH':continue
 anchor=old_world[o.parent].translation.z if o.parent in panel_objects else FACE_ANCHORS.get(o)
 transform=Matrix.Diagonal((PUMP_LAYOUT_FACTOR,1,PUMP_LAYOUT_FACTOR if anchor is not None else PUMP_ROW_FACTOR,1))
 transform.translation.x=PUMP_CENTER_X
 transform.translation.y=PUMP_RECESS_M
 transform.translation.z=PUMP_FACE_BOTTOM_M-.63*PUMP_ROW_FACTOR
 if anchor is not None:transform.translation.z+=anchor*(PUMP_ROW_FACTOR-PUMP_LAYOUT_FACTOR)
 o.data.transform(o.matrix_world.inverted() @ transform @ old_world[o])
 o.data.update()
for c in controls:
 if c['id'] in ('suction','foam'):
  c['positionRange']=[v*PUMP_LAYOUT_FACTOR for v in c['positionRange']]
  for e in c['endpoints']:e['value']*=PUMP_LAYOUT_FACTOR
# Export all model geometry, no cameras or stage.
bpy.ops.object.select_all(action='SELECT')
for o in bpy.context.selected_objects:
 if o.type=='MESH':
  o['asset']='B54 photo-informed approximation'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'models/b54.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'b54.glb'),export_format='GLB',use_selection=True,export_extras=True,export_yup=True,export_apply=True)
manifest={'schemaVersion':1,'asset':'b54.glb','description':'Photo-informed approximate B54 Ford F-550 brush truck; not dimensionally exact; no pump physics','units':'meters','coordinateSystem':{'exported':'right handed, +Y up, front -Z, rear +Z, rear-view right +X','blender':'X right in rear view, +Y front, +Z up','mapping':'glTF = [Blender X, Blender Z, -Blender Y]','controlRoots':'identity rotation and unit scale; position axes are exported parent/local basis; capture initial position and quaternion, then apply offsets, never overwrite base placement'},'rearPanel':{'center':[0,1.54,3.23],'normal':[0,0,1],'suggestedCamera':[0,1.65,5.4],'suggestedTarget':[0,1.55,3.23]},'controls':controls,'staticItems':['gauges','level indicators','emergency stop','foam power switches','drains','caps','compartment doors'],'warnings':['No concealed pump internals modeled','Travel, dimensions and lock angles approximate','HALE PRIME inactive pending confirmation','Tank valve reverse mapping must stay separate','Locks prevent absolutely all translation, not merely add drag resistance','No spring return for OFF/RUN/START selector']}
manifest['rearPanel']={'center':[PUMP_CENTER_X,PUMP_FACE_BOTTOM_M+PUMP_FACE_HEIGHT_M/2,-face_y],'normal':[0,0,1],'width':PUMP_BAY_WIDTH_M,'height':PUMP_FACE_HEIGHT_M,'bounds':{'min':[PUMP_CENTER_X-PUMP_BAY_WIDTH_M/2,PUMP_FACE_BOTTOM_M,-face_y-.12],'max':[PUMP_CENTER_X+PUMP_BAY_WIDTH_M/2,PUMP_FACE_BOTTOM_M+PUMP_FACE_HEIGHT_M,-face_y]},'boundsScope':'flush pump backing only; fittings and pulled handles project rearward toward +Z','widthStatus':'dimensions approximate; flush face and right-side walkway explicitly confirmed by user','suggestedCamera':[PUMP_CENTER_X,1.70,5.05],'suggestedTarget':[PUMP_CENTER_X,1.56,-face_y],'viewGuidance':'Pump face is flush with rear compartment ends. Side walkway is to its right (+X), not a recess surrounding the panel.'}
manifest['rearBay']={'architecture':'flush pump face with separate right-side walkway','openingWidth':WALKWAY_WIDTH_M,'deckDepth':WALKWAY_DEPTH_M,'deckHeight':WALKWAY_TOP_M,'centerX':WALKWAY_CENTER_X,'side':'right / +X viewed from rear','rearPlaneZ':3.22,'pumpFaceZ':-face_y,'bounds':{'min':[WALKWAY_LEFT_X,WALKWAY_TOP_M,3.22-WALKWAY_DEPTH_M],'max':[REAR_BAY_OPENING_M/2,2.43,3.24]},'toolboxExtentZ':[-TOP_TOOLBOX_FRONT_Y,-TOP_TOOLBOX_REAR_Y],'toolboxNode':'Upper tool box.001','lengthRule':'walkway continues alongside the full right silver top toolbox, including rear entry threshold','dimensionsStatus':'toolbox geometry traced; dimensions approximate, full-length relationship user-confirmed','axialStrokeClearance':'0.6 m handle travel intentionally projects beyond the flush rear face; no threshold-containment constraint or operator-clearance simulation.'}
manifest['boosterReel']={'spoolAxis':[0,0,1],'payoutDirection':list(BOOSTER_PAYOUT_DIRECTION),'payoutDescription':'left (-X), viewed from behind truck; complete spool axis runs fore/aft','center':[PUMP_CENTER_X,2.64,.62],'routingNode':'Booster left payout hose','axisNode':'Reel hub','geometryStatus':'orientation confirmed by user; supports and visible routing approximate'}
manifest['hoseBeds']={'laneCount':3,'spanX':[HOSE_BED_LEFT_X,HOSE_BED_RIGHT_X],'deckNode':'Hose bed deck','dividerNodes':['Hose bed divider '+str(i) for i in range(4)],'lanes':hose_lanes,'layout':'three distinct lanes span the full pump assembly width; outer divider edges align with pump backing/deck edges; right walkway remains clear','dimensionsStatus':'approximate clearances; full-width relationship confirmed by user'}
(OUT/'b54-controls.json').write_text(json.dumps(manifest,indent=2)+'\n')
# QA scene only. Saved model and GLB above remain free of stage objects.
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.world.color=(.32,.32,.32)
box('QA ground',(0,0,-.045),(200,200,.05),mat('QA ground',(.09,.12,.15)),0)
for loc,power,size in [((2,-5,7),1900,5),((-5,1,5),2300,5),((1,5,7),2200,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.data.energy=power; o.data.shape='DISK'; o.data.size=size; o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(); camera=bpy.context.object; scene.camera=camera
scene.render.resolution_percentage=100; scene.view_settings.view_transform='AgX'
for name,loc,target,ortho,res in [('front',(7,9,5.2),(0,0,1.4),8.9,(1400,1000)),('rear',(6,-8,4.7),(0,-.4,1.5),8.2,(1400,1000)),('straightrear',(0,-7,2.05),(0,-2.75,1.59),3.10,(1300,1300)),('walkway',(2.2,-4.7,7),(.30,-1.65,1.60),4.4,(1300,1400)),('top_overview',(0,-3.6,9),(0,-1.6,1.60),4.7,(1400,1400)),('top_reel',(-3.6,-4.5,7),(0,-1.3,2.1),4.75,(1400,1200)),('panel',(PUMP_CENTER_X,-6,1.85),(PUMP_CENTER_X,face_y,1.56),1.70,(1300,1300))]:
 camera.location=loc; camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=ortho
 scene.render.resolution_x,scene.render.resolution_y=res; scene.render.filepath=str(QA/(name+'.png')); bpy.ops.render.render(write_still=True)
print('B54 MODEL COMPLETE',len(controls),'controls',OUT/'b54.glb')
