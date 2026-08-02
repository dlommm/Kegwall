// Dart mirrors of the public JSON the Kegwall server returns. Hand-written `fromJson` (no
// codegen) to keep the flutter-pi build toolchain simple. OWNER COST fields are absent from
// the public payload, so they're absent here too — the native client never sees keg cost.

const double _mlPerPint = 473.176;

class Beer {
  const Beer({
    required this.id,
    required this.name,
    this.brewery,
    this.style,
    this.abv,
    this.ibu,
    this.srm,
    this.description,
    this.labelImage,
  });

  final int id;
  final String name;
  final String? brewery;
  final String? style;
  final double? abv;
  final double? ibu;
  final int? srm;
  final String? description;
  final String? labelImage;

  static Beer fromJson(Map<String, dynamic> j) => Beer(
        id: j['id'] as int,
        name: j['name'] as String? ?? '',
        brewery: j['brewery'] as String?,
        style: j['style'] as String?,
        abv: (j['abv'] as num?)?.toDouble(),
        ibu: (j['ibu'] as num?)?.toDouble(),
        srm: (j['srm'] as num?)?.toInt(),
        description: j['description'] as String?,
        labelImage: j['labelImage'] as String?,
      );
}

class Keg {
  const Keg({
    required this.id,
    required this.status,
    required this.sizeMl,
    required this.volStartMl,
    required this.volDispensedMl,
    required this.levelPct,
    required this.remainingMl,
    this.kegType,
  });

  final int id;
  final String status; // on_tap | kicked | on_deck | archived
  final int sizeMl;
  final int volStartMl;
  final int volDispensedMl;
  final double levelPct;
  final double remainingMl;
  final String? kegType;

  bool get isKicked => status == 'kicked';

  static Keg fromJson(Map<String, dynamic> j) => Keg(
        id: j['id'] as int,
        status: j['status'] as String? ?? 'on_tap',
        sizeMl: (j['sizeMl'] as num?)?.toInt() ?? 0,
        volStartMl: (j['volStartMl'] as num?)?.toInt() ?? 0,
        volDispensedMl: (j['volDispensedMl'] as num?)?.toInt() ?? 0,
        levelPct: (j['levelPct'] as num?)?.toDouble() ?? 0,
        remainingMl: (j['remainingMl'] as num?)?.toDouble() ?? 0,
        kegType: j['kegType'] as String?,
      );
}

class TapState {
  const TapState({
    required this.tapId,
    required this.tapNumber,
    this.tapName,
    this.beer,
    this.keg,
    this.pouring = false,
    this.curServMl,
    this.hidden = false,
    this.temp,
    this.avgRating,
    this.pricePerPintCents,
  });

  final int tapId;
  final int tapNumber;
  final String? tapName;
  final Beer? beer;
  final Keg? keg;
  final bool pouring;
  final double? curServMl;
  final bool hidden;
  final double? temp;
  final double? avgRating;
  final int? pricePerPintCents;

  bool get isActive => beer != null && keg != null && !keg!.isKicked;

  /// Remaining pints, rounded — the looks' "N pints" readout.
  int get remainingPints =>
      keg == null || keg!.isKicked ? 0 : (keg!.remainingMl / _mlPerPint).round();

  static TapState fromJson(Map<String, dynamic> j) => TapState(
        tapId: j['tapId'] as int,
        tapNumber: (j['tapNumber'] as num?)?.toInt() ?? 0,
        tapName: j['tapName'] as String?,
        beer: j['beer'] == null ? null : Beer.fromJson(j['beer'] as Map<String, dynamic>),
        keg: j['keg'] == null ? null : Keg.fromJson(j['keg'] as Map<String, dynamic>),
        pouring: j['pouring'] as bool? ?? false,
        curServMl: (j['curServMl'] as num?)?.toDouble(),
        hidden: j['hidden'] as bool? ?? false,
        temp: (j['temp'] as num?)?.toDouble(),
        avgRating: (j['avgRating'] as num?)?.toDouble(),
        pricePerPintCents: (j['pricePerPintCents'] as num?)?.toInt(),
      );
}
