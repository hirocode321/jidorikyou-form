"""
自撮り狂 首掛け名札 一括自動生成ツール
====================================
【機能】
・写真フォルダ内の「{アカウント名}.jpg」を読み込み、名札フォーマットに合わせて一括生成します。
・出力ファイル名：「名札_{アカウント名}.jpg」
・名前の幅自動調整：文字数が多い場合でも、左右の余白を保つよう自動でフォントサイズを縮小調整します。
・写真の自動フィット：写真のアスペクト比が違っても、写真枠（803×1135px）の中央基準で綺麗に自動トリミング配置します。
"""

import io
import os
import sys
import glob
from PIL import Image, ImageCms, ImageDraw, ImageFont, ImageOps

# Windowsコンソールの文字化け防止
sys.stdout.reconfigure(encoding="utf-8")

# 出力に埋め込むsRGBプロファイル（印刷所・ブラウザでの色の解釈を揃える）
SRGB_PROFILE = ImageCms.createProfile("sRGB")
SRGB_ICC_BYTES = ImageCms.ImageCmsProfile(SRGB_PROFILE).tobytes()

# --- 設定値 ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(BASE_DIR, "名札_台紙ベース.png")
INPUT_PHOTO_DIR = os.path.join(BASE_DIR, "写真")
OUTPUT_DIR = os.path.join(BASE_DIR, "完成名札")

# 写真枠の寸法と配置（PSD実寸準拠）
PHOTO_W = 803
PHOTO_H = 1135
PHOTO_X = 189
PHOTO_Y = 418

# 名前の配置エリア設定
NAME_CENTER_X = 1181 // 2
NAME_CENTER_Y = 1650
NAME_MAX_WIDTH = 840      # 写真枠(803px)付近を上限として自動縮小
DEFAULT_FONT_SIZE = 108   # PSD実寸（幅318px, 高さ100px）と完全一致するサイズ

# 使用フォント（ヒラギノ明朝W3の質感・太さに合わせるため游明朝Regularを最優先）
CANDIDATE_FONTS = [
    r"C:\Windows\Fonts\yumin.ttf",          # 游明朝 Regular (ヒラギノ明朝 W3と同一の細さ・質感)
    r"C:\Windows\Fonts\NotoSerifJP-VF.ttf", # Noto Serif JP
    r"C:\Windows\Fonts\yumindb.ttf",       # 游明朝 Demibold
    r"C:\Windows\Fonts\BIZ-UDMinchoM.ttc",  # BIZ UD明朝
    r"C:\Windows\Fonts\msmincho.ttc",       # MS明朝
]

def get_font_path():
    for f in CANDIDATE_FONTS:
        if os.path.exists(f):
            return f
    return None

def fit_crop_image(img, target_w, target_h):
    """アスペクト比を保ちつつ、中央基準で目標サイズに切り抜き（cover）"""
    src_w, src_h = img.size
    scale = max(target_w / src_w, target_h / src_h)
    new_w = int(src_w * scale)
    new_h = int(src_h * scale)
    
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))

def to_srgb(img):
    """埋め込みICCプロファイルがあればsRGBに変換（Display P3 / AdobeRGB写真の色ズレ防止）"""
    icc = img.info.get("icc_profile")
    if not icc:
        return img
    try:
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        return ImageCms.profileToProfile(img.convert("RGB"), src, SRGB_PROFILE, outputMode="RGB")
    except Exception:
        return img

def warn_if_low_res(size, name):
    """枠いっぱいに貼る際に拡大が必要な写真（＝印刷で甘くなる）を警告"""
    w, h = size
    scale = max(PHOTO_W / w, PHOTO_H / h)
    if scale > 1.0:
        print(f"⚠️ 解像度不足: {name} ({w}x{h}px) は {scale:.2f}倍に拡大されるため印刷で甘くなります")

def generate_single_card(account_name, photo_path, template_img, font_path, output_path):
    # 台紙の複製
    card = template_img.copy().convert("RGBA")
    
    # 1. 写真の合成
    try:
        with Image.open(photo_path) as p:
            p = ImageOps.exif_transpose(p)  # スマホ写真の回転情報(EXIF)を反映
            p = to_srgb(p)                  # ICCプロファイル付きの写真はsRGBに変換
            p_rgb = p.convert("RGBA")
            warn_if_low_res(p_rgb.size, os.path.basename(photo_path))
            fitted_photo = fit_crop_image(p_rgb, PHOTO_W, PHOTO_H)
            card.paste(fitted_photo, (PHOTO_X, PHOTO_Y))
    except Exception as e:
        print(f"⚠️ 写真読み込みエラー [{os.path.basename(photo_path)}]: {e}")
        return False

    # 2. 名前の幅自動調整と描画
    draw = ImageDraw.Draw(card)
    font_size = DEFAULT_FONT_SIZE
    font = ImageFont.truetype(font_path, font_size)

    # 縦位置は「Hg」の高さ基準で固定（y/g/pなど下に突き出る文字の有無でベースラインがずれないようにする）
    ref_bbox = font.getbbox("Hg", anchor="ls")
    baseline_y = NAME_CENTER_Y - (ref_bbox[1] + ref_bbox[3]) // 2

    bbox = font.getbbox(account_name, anchor="ls")
    text_w = bbox[2] - bbox[0]

    # 最大幅を超える場合は比率に応じてフォントサイズを自動縮小
    if text_w > NAME_MAX_WIDTH:
        font_size = int(DEFAULT_FONT_SIZE * (NAME_MAX_WIDTH / text_w))
        font = ImageFont.truetype(font_path, font_size)
        bbox = font.getbbox(account_name, anchor="ls")
        text_w = bbox[2] - bbox[0]

    # 水平方向は中央揃え、垂直方向は固定ベースライン
    x = NAME_CENTER_X - (bbox[0] + bbox[2]) // 2

    # 文字描画（黒色）
    draw.text((x, baseline_y), account_name, font=font, fill=(0, 0, 0, 255), anchor="ls")
    
    # 3. JPEG保存（印刷用高画質 300dpi, 最高画質quality=98, 色間引きなしsubsampling=0）
    card.convert("RGB").save(output_path, "JPEG", quality=98, dpi=(300, 300), subsampling=0, icc_profile=SRGB_ICC_BYTES)
    print(f"✅ 作成完了: {os.path.basename(output_path)} (文字サイズ: {font_size}pt, 幅: {text_w}px)")
    return True

def main():
    print("=" * 60)
    print("  自撮り狂 首掛け名札 一括自動生成ツール")
    print("=" * 60)
    
    if not os.path.exists(TEMPLATE_PATH):
        print(f"❌ 台紙画像が見つかりません: {TEMPLATE_PATH}")
        input("Enterキーを押して終了してください...")
        return
    
    font_path = get_font_path()
    if not font_path:
        print("❌ 利用可能な明朝フォントが見つかりませんでした。")
        input("Enterキーを押して終了してください...")
        return
    print(f"🔤 使用フォント: {os.path.basename(font_path)}")
    
    os.makedirs(INPUT_PHOTO_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 写真フォルダ内の jpg / png / jpeg ファイルを検索
    photo_files = []
    for ext in ("*.jpg", "*.jpeg", "*.png", "*.JPG", "*.JPEG", "*.PNG"):
        photo_files.extend(glob.glob(os.path.join(INPUT_PHOTO_DIR, ext)))
    
    # 重複除外
    photo_files = sorted(list(set(photo_files)))
    
    if not photo_files:
        print(f"\n⚠️ 「写真」フォルダに対象画像がありません。")
        print(f"   以下のフォルダに「{{アカウント名}}.jpg」を入れてから再実行してください：")
        print(f"   📁 {INPUT_PHOTO_DIR}\n")
        input("Enterキーを押して終了してください...")
        return
    
    print(f"\n📸 {len(photo_files)} 件の写真が見つかりました。生成を開始します...\n")
    template_img = Image.open(TEMPLATE_PATH)
    
    success_count = 0
    for photo_path in photo_files:
        filename = os.path.basename(photo_path)
        # 拡張子を除いた部分をアカウント名とする
        account_name = os.path.splitext(filename)[0]
        
        output_filename = f"名札_{account_name}.jpg"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        
        if generate_single_card(account_name, photo_path, template_img, font_path, output_path):
            success_count += 1
            
    print("\n" + "=" * 60)
    print(f"🎉 すべての処理が完了しました！ ({success_count}/{len(photo_files)} 件成功)")
    print(f"📁 保存先フォルダ: {OUTPUT_DIR}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
