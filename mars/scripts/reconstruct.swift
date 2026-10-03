import Foundation
import RealityKit
import simd
@main struct Reconstruct {
 static func main() async throws {
  print("supported",PhotogrammetrySession.isSupported,"limit",PhotogrammetrySession.limits.maximumNumberOfInputImages)
  let args=CommandLine.arguments
  guard args.count >= 3 else { return }
  let input=URL(fileURLWithPath:args[1]);let output=URL(fileURLWithPath:args[2])
  try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
  var config=PhotogrammetrySession.Configuration();config.sampleOrdering = .unordered;config.featureSensitivity = .high;config.isObjectMaskingEnabled=false
  let custom = args.count > 3 && args[3] == "custom"
  let raw = args.count > 3 && args[3] == "raw"
  if custom {
   config.customDetailSpecification.maximumPolygonCount=1_000_000
   config.customDetailSpecification.maximumTextureDimension = .eightK
   config.customDetailSpecification.outputTextureMaps = [.diffuseColor]
   config.customDetailSpecification.textureFormat = .jpeg(compressionQuality: 0.97)
   config.checkpointDirectory = output.appendingPathComponent("checkpoints")
  }
  if args.count > 4 { config.checkpointDirectory = URL(fileURLWithPath:args[4]) }
  let session=try PhotogrammetrySession(input:input,configuration:config)
  try session.process(requests:[.modelFile(url:output.appendingPathComponent("campus.usdz"),detail:raw ? .raw : (custom ? .custom : .full)),.poses,.pointCloud])
  for try await event in session.outputs {
   switch event {
   case .requestComplete(_,let result):
    switch result {
    case .poses(let p):
     let rows=p.posesBySample.map {id,pose -> [String:Any] in
      ["id":id,"file":p.urlsBySample[id]?.lastPathComponent ?? "","translation":[pose.translation.x,pose.translation.y,pose.translation.z],"rotation_xyzw":[pose.rotation.imag.x,pose.rotation.imag.y,pose.rotation.imag.z,pose.rotation.real]]
     }
     try JSONSerialization.data(withJSONObject:rows,options:.prettyPrinted).write(to:output.appendingPathComponent("poses.json"));print("POSES",rows.count)
    case .pointCloud(let cloud):
     var text="ply\nformat ascii 1.0\nelement vertex \(cloud.points.count)\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
     for p in cloud.points {text += "\(p.position.x) \(p.position.y) \(p.position.z) \(p.color.x) \(p.color.y) \(p.color.z)\n"}
     try text.write(to:output.appendingPathComponent("points.ply"),atomically:true,encoding:.utf8);print("POINTS",cloud.points.count)
    default:print("RESULT",result)
    }
   case .processingComplete:print("COMPLETE");return
   case .requestError(let r,let e):print("ERROR",r,e)
   default:print(event)
   }
   fflush(stdout)
  }
 }
}
