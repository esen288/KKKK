<?php
declare(strict_types=1);
define('NOVAX',true);
require __DIR__.'/private/core.php';
security_headers();
header('Cache-Control: no-store');
try {
    if (!is_installed()) throw new UserError('Önce install.php sayfasından site kurulumunu tamamlayın.',503);
    $route=trim((string)($_GET['route']??''),'/');
    $actual=$_SERVER['REQUEST_METHOD'];$method=$actual;
    if ($actual==='POST' && isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
        $method=strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
        if (!in_array($method,['PUT','DELETE'],true)) throw new UserError('Geçersiz işlem.',405);
    }
    if ($route==='content' && $method==='GET') json_response(public_content());
    begin_session();ensure_https();
    if ($route==='csrf' && $method==='GET') json_response(['csrf'=>$_SESSION['csrf']]);
    if (!in_array($method,['GET','POST','PUT','DELETE'],true)) throw new UserError('Desteklenmeyen işlem.',405);
    if($method!=='GET')csrf_check($_SERVER['HTTP_X_CSRF_TOKEN']??null);
    $body=[];
    if($method!=='GET' && $method!=='DELETE') {
        $type=strtolower($_SERVER['CONTENT_TYPE']??'');
        if(str_starts_with($type,'application/json')) {
            if((int)($_SERVER['CONTENT_LENGTH']??0)>65536)throw new UserError('İstek çok büyük.',413);
            $raw=file_get_contents('php://input',false,null,0,65537);if(strlen($raw)>65536)throw new UserError('İstek çok büyük.',413);
            try{$body=$raw===''?[]:json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(JsonException){throw new UserError('Geçersiz istek.');}
            if(!is_array($body))throw new UserError('Geçersiz istek.');
        } elseif(str_starts_with($type,'multipart/form-data')) {
            if((int)($_SERVER['CONTENT_LENGTH']??0)>10*1024*1024)throw new UserError('Fotoğraf en fazla 8 MB olabilir.',413);
            if(!$_POST)throw new UserError('Yükleme alınamadı. PHP post_max_size en az 10M ve upload_max_filesize en az 8M olmalı.');
            $body=$_POST;
        } else throw new UserError('JSON veya fotoğraf formu gönderin.',415);
    }
    if($route==='login' && $method==='POST') {
        throttle('login-ip:'.($_SERVER['REMOTE_ADDR']??''));throttle('login-account',60);
        $username=text_value($body['username']??null,100,true);$password=password_value($body['password']??null);
        $admin=query('SELECT * FROM nv_admin WHERE id=1')->fetch();
        $ok=password_verify($password,$admin['password']);
        if(!$ok || !hash_equals($admin['username'],$username))throw new UserError('Kullanıcı adı veya şifre hatalı.',401);
        if(password_needs_rehash($admin['password'],PASSWORD_DEFAULT))query('UPDATE nv_admin SET password=? WHERE id=1',[password_hash($password,PASSWORD_DEFAULT)]);
        session_regenerate_id(true);$_SESSION=['admin'=>1,'version'=>(int)$admin['version'],'expires'=>time()+28800,'csrf'=>bin2hex(random_bytes(32))];
        json_response(['csrf'=>$_SESSION['csrf']]);
    }
    $admin=authenticated();
    if($route==='admin/session' && $method==='GET')json_response(['csrf'=>$_SESSION['csrf'],'username'=>$admin['username']]);
    if($route==='admin/logout' && $method==='POST'){end_session();json_response(['ok'=>true]);}
    if($route==='admin/password' && $method==='PUT') {
        throttle('password:'.($_SERVER['REMOTE_ADDR']??''));
        $current=password_value($body['current']??null);$password=password_value($body['password']??null,true);
        if(!password_verify($current,$admin['password']))throw new UserError('Mevcut şifre yanlış.');
        query('UPDATE nv_admin SET password=?,version=version+1 WHERE id=1',[password_hash($password,PASSWORD_DEFAULT)]);end_session();json_response(['ok'=>true]);
    }
    if($route==='admin/settings' && $method==='PUT') {
        $settings=[];
        foreach(['brand'=>100,'phone'=>24,'whatsapp'=>24,'area'=>250,'address'=>500,'hours'=>250,'mapUrl'=>1000,'about'=>5000,'heroTitle'=>100,'heroText'=>500] as $key=>$max)$settings[$key]=text_value($body[$key]??null,$max,in_array($key,['brand','heroTitle','heroText'],true));
        foreach(['phone','whatsapp'] as $key)if(!preg_match('/^\+?[\d\s()\-]{10,24}$/D',$settings[$key]))throw new UserError('Geçerli telefon ve WhatsApp numarası girin.');
        if($settings['mapUrl']!=='') {
            $u=parse_url($settings['mapUrl']);
            if(!$u || ($u['scheme']??'')!=='https' || !in_array(strtolower($u['host']??''),['google.com','www.google.com','maps.google.com','maps.app.goo.gl'],true) || isset($u['user']) || isset($u['pass']))throw new UserError('HTTPS Google Haritalar bağlantısı kullanın.');
        }
        query('UPDATE nv_settings SET value=? WHERE id=1',[json_encode($settings,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);json_response(['ok'=>true]);
    }
    if(preg_match('~^admin/services(?:/([a-f0-9-]{32,36}))?$~D',$route,$match)) {
        $id=$match[1]??null;
        if($id && !query('SELECT id FROM nv_services WHERE id=?',[$id])->fetch())throw new UserError('Hizmet bulunamadı.',404);
        if($method==='DELETE' && $id){query('DELETE FROM nv_services WHERE id=?',[$id]);json_response(['ok'=>true]);}
        if(($method==='POST' && !$id) || ($method==='PUT' && $id)) {
            $title=text_value($body['title']??null,120,true);$description=text_value($body['description']??null,2000,true);
            if(!isset($body['available']) || !is_bool($body['available']))throw new UserError('Hizmet durumunu seçin.');$available=(int)$body['available'];
            if($id){query('UPDATE nv_services SET title=?,description=?,available=? WHERE id=?',[$title,$description,$available,$id]);json_response(['ok'=>true]);}
            if((int)query('SELECT COUNT(*) FROM nv_services')->fetchColumn()>=30)throw new UserError('En fazla 30 hizmet eklenebilir.');
            $id=bin2hex(random_bytes(16));query('INSERT INTO nv_services (id,title,description,available,position) VALUES (?,?,?,?,?)',[$id,$title,$description,$available,time()]);json_response(['id'=>$id],201);
        }
    }
    if(preg_match('~^admin/projects(?:/([a-f0-9-]{32,36}))?$~D',$route,$match)) {
        $id=$match[1]??null;$existing=$id?query('SELECT * FROM nv_projects WHERE id=?',[$id])->fetch():null;
        if($id && !$existing)throw new UserError('Proje bulunamadı.',404);
        if($method==='DELETE' && $id){query('DELETE FROM nv_projects WHERE id=?',[$id]);remove_image($existing['image']);json_response(['ok'=>true]);}
        if(($method==='POST' && !$id) || ($method==='PUT' && $id)) {
            $title=text_value($body['title']??null,120,true);$category=text_value($body['category']??null,80,true);$description=text_value($body['description']??null,5000,true);
            $newImage=uploaded_image();$image=$newImage??($existing['image']??null);$demo=$newImage?0:(int)($existing['demo']??0);
            if(!$image)throw new UserError('Bir proje fotoğrafı seçin.');
            try {
                if($existing)query('UPDATE nv_projects SET title=?,category=?,description=?,image=?,demo=? WHERE id=?',[$title,$category,$description,$image,$demo,$id]);
                else{$id=bin2hex(random_bytes(16));query('INSERT INTO nv_projects (id,title,category,description,image,demo,created) VALUES (?,?,?,?,?,?,?)',[$id,$title,$category,$description,$image,0,(int)round(microtime(true)*1000)]);}
            }catch(Throwable $e){if($newImage)remove_image($newImage);throw $e;}
            if($existing && $existing['image']!==$image)remove_image($existing['image']);
            json_response(['id'=>$id],$existing?200:201);
        }
    }
    throw new UserError('İşlem bulunamadı.',404);
}catch(UserError $e){json_response(['error'=>$e->getMessage()],$e->status);}
catch(Throwable $e){error_log('Novax API: '.get_class($e).' code '.$e->getCode());json_response(['error'=>'Sunucu işlemi tamamlayamadı. Hostingin hata kayıtlarını ve veritabanı bağlantısını kontrol edin.'],500);}
