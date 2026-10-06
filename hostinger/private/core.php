<?php
declare(strict_types=1);
if (!defined('NOVAX')) { http_response_code(404); exit; }
const NOVAX_ROOT = __DIR__ . '/..';
const NOVAX_CONFIG = __DIR__ . '/config.php';
class UserError extends RuntimeException {
    public function __construct(string $message, public int $status = 400) { parent::__construct($message); }
}
function security_headers(): void {
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: DENY');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
function is_installed(): bool { return is_file(NOVAX_CONFIG); }
function config(): array { static $c; return $c ??= require NOVAX_CONFIG; }
function https_request(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (int)($_SERVER['SERVER_PORT'] ?? 0) === 443; }
function localhost_request(): bool {
    return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1','::1'], true)
        && in_array(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0], ['localhost','127.0.0.1'], true);
}
function ensure_https(): void {
    if (!https_request() && !localhost_request()) throw new UserError('Bu işlemi sitenizin HTTPS adresinden açın. Hostinger panelinden SSL ve HTTPS yönlendirmesini etkinleştirin.', 403);
}
function begin_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $dir = __DIR__ . '/runtime/sessions';
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('Session storage unavailable');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '28800');
    session_save_path($dir);
    session_name('novax_admin');
    session_set_cookie_params(['lifetime'=>28800,'path'=>'/','secure'=>https_request(),'httponly'=>true,'samesite'=>'Strict']);
    if (!session_start()) throw new RuntimeException('Cannot start session');
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}
function csrf_check(?string $token): void {
    if (!$token || !hash_equals($_SESSION['csrf'] ?? '', $token)) throw new UserError('Güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.',403);
    // Origin host check is independent of reverse-proxy HTTP scheme handling.
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $u = parse_url($origin);
        $expected = strtolower($_SERVER['HTTP_HOST'] ?? '');
        $actual = strtolower(($u['host'] ?? '') . (isset($u['port']) ? ':'.$u['port'] : ''));
        if (!$u || $actual !== $expected || !in_array($u['scheme'] ?? '', ['https','http'], true)) throw new UserError('İsteği sitenin kendi yönetim panelinden gönderin.',403);
    }
}
function json_response(array $data, int $status=200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR); exit;
}
function text_value(mixed $value, int $max=5000, bool $required=false): string {
    if (!is_string($value) || !mb_check_encoding($value,'UTF-8') || mb_strlen($value,'UTF-8')>$max) throw new UserError('Geçersiz veya çok uzun metin.');
    $value=trim($value); if ($required && $value==='') throw new UserError('Gerekli alanları doldurun.'); return $value;
}
function password_value(mixed $value, bool $new=false): string {
    if (!is_string($value) || strlen($value)>72 || ($new && strlen($value)<12) || str_contains((string)$value,"\0")) throw new UserError('Şifre 12–72 bayt uzunluğunda olmalı; uzun Türkçe karakterli şifrelerde sınır daha erken dolabilir.');
    return $value;
}
function connect_db(array $c): PDO {
    return new PDO('mysql:host='.$c['db_host'].';port='.$c['db_port'].';dbname='.$c['db_name'].';charset=utf8mb4', $c['db_user'], $c['db_password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES=>false, PDO::ATTR_TIMEOUT=>8]);
}
function db(): PDO { static $db; return $db ??= connect_db(config()); }
function query(string $sql, array $params=[]): PDOStatement { $q=db()->prepare($sql);$q->execute($params);return $q; }
function authenticated(): array {
    begin_session(); ensure_https();
    if (empty($_SESSION['admin']) || ($_SESSION['expires']??0)<time()) throw new UserError('Oturum açmanız gerekiyor.',401);
    $admin=query('SELECT * FROM nv_admin WHERE id=1')->fetch();
    if (!$admin || (int)$admin['version'] !== ($_SESSION['version']??0)) throw new UserError('Oturumunuz sona erdi. Yeniden giriş yapın.',401);
    return $admin;
}
function end_session(): void {
    $_SESSION=[];
    setcookie(session_name(),'', ['expires'=>time()-3600,'path'=>'/','secure'=>https_request(),'httponly'=>true,'samesite'=>'Strict']);
    session_destroy();
}
function throttle(string $scope, int $limit=12, int $window=900): void {
    $key=hash('sha256',$scope);$now=time();
    query('INSERT INTO nv_attempts (bucket,started,hits) VALUES (?,?,1) ON DUPLICATE KEY UPDATE hits=IF(started < ?,1,hits+1),started=IF(started < ?,?,started)',[$key,$now,$now-$window,$now-$window,$now]);
    if ((int)query('SELECT hits FROM nv_attempts WHERE bucket=?',[$key])->fetchColumn()>$limit) {
        header('Retry-After: '.$window);throw new UserError('Çok fazla deneme. Bir süre sonra tekrar deneyin.',429);
    }
    if (random_int(1,50)===1) query('DELETE FROM nv_attempts WHERE started < ?',[$now-86400]);
}
function public_content(): array {
    $settings=json_decode(query('SELECT value FROM nv_settings WHERE id=1')->fetchColumn(),true,512,JSON_THROW_ON_ERROR);
    $services=query('SELECT id,title,description,available FROM nv_services ORDER BY position,id')->fetchAll();
    $projects=query('SELECT id,title,category,description,image,demo,created FROM nv_projects ORDER BY created DESC,id')->fetchAll();
    foreach($services as &$s) $s['available']=(int)$s['available'];unset($s);
    foreach($projects as &$p){$p['demo']=(int)$p['demo'];$p['created']=(int)$p['created'];}unset($p);
    return compact('settings','services','projects');
}
function remove_image(string $image): void {
    if (preg_match('~^uploads/[a-f0-9]{32}\.webp$~D',$image)) {
        $file=NOVAX_ROOT.'/'.$image; if (is_file($file)) @unlink($file);
    }
}
function uploaded_image(): ?string {
    if (empty($_FILES['image']) || $_FILES['image']['error']===UPLOAD_ERR_NO_FILE) return null;
    $f=$_FILES['image'];
    if (!is_int($f['error']) || $f['error']!==UPLOAD_ERR_OK || $f['size']>8*1024*1024 || !is_uploaded_file($f['tmp_name'])) throw new UserError('Tek bir JPG, PNG veya WebP fotoğraf seçin; boyutu en fazla 8 MB olmalı.');
    $info=@getimagesize($f['tmp_name']);
    if (!$info || !in_array($info[2],[IMAGETYPE_JPEG,IMAGETYPE_PNG,IMAGETYPE_WEBP],true)) throw new UserError('Yalnızca gerçek JPG, PNG ve WebP fotoğrafları kabul edilir.');
    if ($info[0]*$info[1]>20000000 || $info[0]<1 || $info[1]<1) throw new UserError('Fotoğraf en fazla 20 megapiksel olabilir. Daha küçük bir kopyasını yükleyin.');
    $limit=ini_get('memory_limit');$bytes=(int)$limit;$last=strtolower(substr($limit,-1));if($last==='g')$bytes*=1024*1024*1024;elseif($last==='m')$bytes*=1024*1024;elseif($last==='k')$bytes*=1024;
    if ($bytes>0 && memory_get_usage(true)+$info[0]*$info[1]*8+32*1024*1024>$bytes) throw new UserError('Bu fotoğraf hostingin görsel işleme sınırını aşıyor. Daha küçük bir kopyasını yükleyin.');
    $image=@imagecreatefromstring(file_get_contents($f['tmp_name']));
    if (!$image) throw new UserError('Fotoğraf okunamadı. Başka bir JPG, PNG veya WebP dosyası deneyin.');
    if ($info[2]===IMAGETYPE_JPEG && function_exists('exif_read_data')) {
        $exif=@exif_read_data($f['tmp_name']);$orientation=(int)($exif['Orientation']??1);
        if (in_array($orientation,[2,4,5,7],true)) imageflip($image, in_array($orientation,[2,5,7],true)?IMG_FLIP_HORIZONTAL:IMG_FLIP_VERTICAL);
        $angle=match($orientation){3=>180,5,8=>90,6,7=>-90,default=>0};
        if($angle){$rotated=imagerotate($image,$angle,0);imagedestroy($image);$image=$rotated;}
    }
    $w=imagesx($image);$h=imagesy($image);$scale=min(1,1800/$w,1800/$h);$nw=max(1,(int)round($w*$scale));$nh=max(1,(int)round($h*$scale));
    $output=imagecreatetruecolor($nw,$nh);imagealphablending($output,false);imagesavealpha($output,true);imagefill($output,0,0,imagecolorallocatealpha($output,0,0,0,127));
    imagecopyresampled($output,$image,0,0,0,0,$nw,$nh,$w,$h);
    $name=bin2hex(random_bytes(16)).'.webp';$relative='uploads/'.$name;$file=NOVAX_ROOT.'/'.$relative;
    try{if(!imagewebp($output,$file,84) || !is_file($file) || filesize($file)===0)throw new RuntimeException('Image write failed');chmod($file,0644);}catch(Throwable $e){@unlink($file);throw $e;}finally{imagedestroy($image);imagedestroy($output);}
    return $relative;
}
