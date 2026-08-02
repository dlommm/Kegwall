import 'package:flutter/widgets.dart';

import 'app/wall_app.dart';
import 'config.dart';

/// Entry point for the native Kegwall wall. Runs full-screen with no Material chrome — the
/// whole surface is the tap wall. `flutter-pi` renders this bundle directly on DRM/KMS.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final config = WallAppConfig.load();
  runApp(WallApp(config: config));
}
