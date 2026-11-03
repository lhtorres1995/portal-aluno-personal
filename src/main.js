import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import './styles.css';

/* ==========================================================================
   LT360 — Portal do Aluno (v1 integrada)
   Visual LT360 aprovado + dados REAIS do Supabase onde existem.
   O que é mock (marcado): disponibilidade/solicitações (Fase 3), cobranças
   (Fase 4), e os blocos "Meu progresso" e, quando não há aulas concluídas,
   "Últimas atividades". Tudo o mais vem do banco sob RLS de aluno.
   Campos ainda inexistentes no schema de aulas (título, tipo e local do
   treino) usam valores padrão — adicioná-los como colunas no futuro restaura
   a riqueza total dos cartões.
   ========================================================================== */
(function(){
  "use strict";

  // PWA: registra o service worker (instalável + offline básico).
  if ("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("/sw.js").catch(function(e){ console.warn("SW não registrado:", e); });
    });
  }

  /* ---------------- Push (notificações) ---------------------------------- */
  var VAPID_PUBLIC = "BKE_rvm-bWgqtyXo060a1aJCWl5MP8tTieToNbcGKUJbBuyKOIsftrnF5biHRsd9haNdP3FtMPp6a-bl_pICWco";
  function pushSuportado(){ return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window); }
  function b64ToUint8(b64){
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64); var arr = new Uint8Array(raw.length);
    for (var i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
    return arr;
  }
  async function estadoNotif(){
    if(!pushSuportado()) return "indisponivel";
    if(Notification.permission === "denied") return "bloqueado";
    try{ var reg = await navigator.serviceWorker.ready; var sub = await reg.pushManager.getSubscription(); return sub ? "ativo" : "inativo"; }
    catch(e){ return "inativo"; }
  }
  window.renderNotifBloco = async function(){
    var box = document.getElementById("notif-bloco");
    if(!box) return;
    var st = await estadoNotif();
    if(st === "indisponivel"){
      box.innerHTML = '<div class="notif-bloco-s">Seu navegador não suporta notificações. No iPhone, instale o app na tela inicial para receber.</div>';
    } else if(st === "bloqueado"){
      box.innerHTML = '<div class="notif-bloco-s">As notificações estão bloqueadas nas configurações do navegador para este site. Libere-as ali para ativar.</div>';
    } else if(st === "ativo"){
      box.innerHTML = '<div class="notif-row-estado"><span class="notif-on">'+IC.check+' Ativadas neste aparelho</span>'+
        '<button class="btn btn-dark" onclick="desativarNotificacoes()">Desativar</button></div>';
    } else {
      box.innerHTML = '<div class="notif-bloco-s">Receba avisos de solicitações respondidas, aulas e pagamentos.</div>'+
        '<button class="btn btn-primary block" onclick="ativarNotificacoes()">'+IC.bell+' Ativar notificações</button>';
    }
  };
  window.ativarNotificacoes = async function(){
    if(!pushSuportado()){ toast("Seu navegador não suporta notificações."); return; }
    try{
      var perm = await Notification.requestPermission();
      if(perm !== "granted"){ toast("Permissão não concedida."); renderNotifBloco(); return; }
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if(!sub){
        sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToUint8(VAPID_PUBLIC) });
      }
      var j = sub.toJSON();
      var r = await sb.rpc("salvar_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
      if(r.error) throw r.error;
      toast("Notificações ativadas!");
      renderNotifBloco();
    }catch(e){ console.error(e); toast("Não consegui ativar as notificações."); renderNotifBloco(); }
  };
  window.desativarNotificacoes = async function(){
    try{
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if(sub){ try{ await sb.rpc("remover_push_subscription", { p_endpoint: sub.endpoint }); }catch(_){} await sub.unsubscribe(); }
      toast("Notificações desativadas.");
      renderNotifBloco();
    }catch(e){ console.error(e); toast("Não consegui desativar."); renderNotifBloco(); }
  };

  var DIAS = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
  var MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

  function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
  function doisDig(n){ return (n<10?"0":"")+n; }
  function dataLocalStr(d){ return d.getFullYear()+"-"+doisDig(d.getMonth()+1)+"-"+doisDig(d.getDate()); }
  function fmtDataBR(iso){ var p=iso.split("-"); return p[2]+"/"+p[1]+"/"+p[0]; }
  function diaSemanaLabel(iso){ return DIAS[new Date(iso+"T00:00:00").getDay()]; }
  function dataLongaBR(d){ return capitalizar(DIAS[d.getDay()])+", "+d.getDate()+" de "+MESES[d.getMonth()]+" de "+d.getFullYear(); }
  function iniciais(nome){ var p=(nome||"").trim().split(/\s+/); if(!p[0])return"A"; return (p[0][0]+(p[1]?p[1][0]:"")).toUpperCase(); }
  // Escapa dados de usuário antes de inserir no HTML (proteção contra XSS).
  var ESC_MAP={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return ESC_MAP[c];}); }
  function avatarInner(){ return meuFotoUrl ? '<img class="avatar-img" src="'+esc(meuFotoUrl)+'" alt="">' : iniciais(meuNome); }
  // Logo do personal (se houver) ou iniciais, exibida na caixa "Seu personal".
  function logoPersonalBox(){
    return logoPersonal
      ? '<span class="avatar avatar-foto logo-av"><img class="logo-av-img" src="'+esc(logoPersonal)+'" alt=""></span>'
      : '<span class="avatar avatar-foto">'+iniciais(nomePersonal)+'</span>';
  }
  function toast(msg){
    var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show");
    clearTimeout(t.__t); t.__t=setTimeout(function(){ t.classList.remove("show"); },2200);
  }
  window.toast = toast;

  var HOJE = new Date();
  var HOJE_STR = dataLocalStr(HOJE);

  /* ---------------- Supabase (auth com lock desativado) ------------------- */
  var SB_URL = import.meta.env.VITE_SUPABASE_URL;
  var SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  var sb = createClient(SB_URL, SB_KEY, {
    auth: { lock: function(name, acquireTimeout, fn){ return fn(); } }
  });

  /* ---------------- Estado (dados reais) ---------------------------------- */
  var meuAlunoId=null, meuProfessorId=null, meuNome="", meuEmail="", meuTelefone="", meuFotoUrl=null;
  var meuTreinoTipo="forca", meuTreinoLocal="", meuEndereco="", meuCheckinToken="";
  var meuPlanoCobranca="", meuValorAula=0;
  var nomePersonal="Seu personal", logoPersonal=null, pixPersonal="", telefonePersonal="";
  var pixTipoPersonal="", cidadePersonal="";
  var dispPersonal=[]; // disponibilidade do personal: {dia, ini, fim} (dias 0-6)
  var aulas = [];              // reais: {id,data,hora,status}
  var minhasSolicitacoes = []; // reais: {id,aulaId,tipo,dataSugerida,horaSugerida,status,createdAt}
  var minhasCobrancas = [];    // reais: {id,valor,label,status,vencimento,pagamento}
  var minhasAvaliacoes = [];       // reais: {id,data,observacoes,aulaId,createdAt}
  var minhasAvaliacoesItens = [];  // reais: {id,avaliacaoId,metricaId,valor,unidade}
  var metricasCatalogoAluno = [];  // reais: {id,codigo,nome,categoria,unidade}
  var tabAtual = "inicio";
  var aulasTab = "proximas";   // sub-aba da tela Aulas
  var agendaSel = HOJE_STR;    // dia selecionado na Agenda
  var agendaAno = HOJE.getFullYear(), agendaMes = HOJE.getMonth(); // mês exibido na Agenda
  var agendaView = "mes";      // mes | semana | lista
  var solicTab = "todas";      // todas | em_analise | aprovada | negada
  var finTab = "cobrancas";    // cobrancas | historico
  var avalMetricaSel = null;     // id da métrica escolhida no gráfico de evolução (null = decide no 1º render)
  var avalVerTodas = false;      // "ver todas as medidas" do comparativo expandido
  var avalExpandidas = {};       // {avaliacaoId: true} — linhas do histórico abertas
  var aulasCountdownTimer = null; // intervalo do "faltam Xh Ymin" da tela Aulas

  /* ---------------- MOCK (marcado) ---------------------------------------- */
  // Solicitações e Financeiro agora são REAIS. Só resta mock o bloco de
  // progresso (peso), que ainda não tem fonte de dados.
  var MOCK = {
    progresso:{ peso:"—", pesoDelta:"", aulasRealizadas:null }
  };
  function fmtMoeda(v){ return "R$ "+Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
  var seqSolic = 1;

  /* =========================================================================
     AUTENTICAÇÃO (idêntica à versão validada — não alterar à toa)
     ========================================================================= */
  var authEventJaProcessado=false, sessaoConvite=null;
  function precisaDefinirSenha(session){ var m=session&&session.user&&session.user.user_metadata; return !!(m&&m.must_set_password); }
  function decidirDestino(session){
    if (precisaDefinirSenha(session)){
      sessaoConvite=session;
      document.getElementById("gate-loading").hidden=true;
      document.getElementById("gate-auth").hidden=false;
      mostrarAuthView("convite");
    } else { aposLogin(session); }
  }
  var urlTemAuthPendente = /access_token=|refresh_token=|[?&]code=|type=/.test(window.location.href);
  function resolverEstadoInicial(session){
    if (authEventJaProcessado) return;
    authEventJaProcessado=true;
    if (session){ decidirDestino(session); } else { mostrarGateAuth(); }
  }
  sb.auth.onAuthStateChange(function(event, session){
    if (event==="SIGNED_OUT"){ mostrarGateAuth(); mostrarAuthView("login"); return; }
    if (!authEventJaProcessado && !session && urlTemAuthPendente && event==="INITIAL_SESSION") return;
    resolverEstadoInicial(session);
  });
  if (!urlTemAuthPendente){
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(e){ console.error(e); });
  }
  function mostrarGateAuth(){ document.getElementById("gate-loading").hidden=true; document.getElementById("gate-auth").hidden=false; }
  function mostrarAuthView(nome){
    document.getElementById("authview-login").hidden = nome!=="login";
    document.getElementById("authview-convite").hidden = nome!=="convite";
  }
  function setErro(id,msg){ var e=document.getElementById(id); if(!e)return; e.textContent=msg||""; e.hidden=!msg; }
  window.toggleSenha = function(id){ var i=document.getElementById(id); if(i) i.type=i.type==="password"?"text":"password"; };

  window.entrar = async function(ev){
    ev.preventDefault();
    var email=document.getElementById("login-email").value.trim();
    var senha=document.getElementById("login-senha").value;
    var btn=document.getElementById("login-submit");
    setErro("login-erro","");
    if(!email||!senha){ setErro("login-erro","Informe e-mail e senha."); return; }
    btn.disabled=true; btn.textContent="Entrando...";
    try{ var r=await sb.auth.signInWithPassword({email:email,password:senha}); if(r.error) throw r.error; await aposLogin(r.data.session); }
    catch(err){ setErro("login-erro", traduzErroAuth(err)); btn.disabled=false; btn.textContent="Entrar"; }
  };
  window.definirSenhaConvite = async function(ev){
    ev.preventDefault();
    var senha=document.getElementById("convite-senha").value;
    var conf=document.getElementById("convite-senha-confirma").value;
    var btn=document.getElementById("convite-submit");
    setErro("convite-erro","");
    if(senha.length<6){ setErro("convite-erro","A senha precisa ter pelo menos 6 caracteres."); return; }
    if(senha!==conf){ setErro("convite-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{
      var r=await sb.auth.updateUser({password:senha,data:{must_set_password:false}}); if(r.error) throw r.error;
      var s=await sb.auth.getSession();
      if(!s.data.session) throw new Error("Sessão expirou. Peça um novo convite ao seu personal.");
      await aposLogin(s.data.session,true);
    } catch(err){
      console.error("Erro ao definir senha do convite:",err);
      setErro("convite-erro",(err&&err.message)||"Não foi possível salvar a senha. Peça um novo convite.");
      btn.disabled=false; btn.textContent="Criar senha e entrar";
    }
  };
  function traduzErroAuth(err){
    var m=(err&&err.message)||"Erro ao autenticar.";
    if(/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
    if(/Email not confirmed/i.test(m)) return "Confirme seu e-mail antes de entrar.";
    return m;
  }
  async function aposLogin(session, viaConvite){
    if(!viaConvite && precisaDefinirSenha(session)) return;
    try{ await carregarMeusDados(session.user.id); }
    catch(err){
      console.error(err);
      mostrarGateAuth();
      setErro("login-erro","Não consegui carregar seus dados. Tente novamente em alguns minutos.");
      var b=document.getElementById("login-submit"); if(b){ b.disabled=false; b.textContent="Entrar"; }
      var bc=document.getElementById("convite-submit"); if(bc){ bc.disabled=false; bc.textContent="Criar senha e entrar"; }
      return;
    }
    document.getElementById("gate").hidden=true;
    document.getElementById("app").hidden=false;
    document.getElementById("topbar-date").textContent = dataLongaBR(HOJE);
    document.getElementById("btn-bell").innerHTML = IC.bell;
    document.getElementById("topbar-avatar").innerHTML = avatarInner();
    renderShell();
    ir("inicio");
  }

  async function carregarMeusDados(authUserId){
    var alunoRes = await sb.from("alunos").select("id, nome, telefone, professor_id, treino_tipo, treino_local, plano_cobranca, valor_aula, foto_url, endereco").eq("auth_user_id", authUserId).maybeSingle();
    if (alunoRes.error) throw alunoRes.error;
    if (!alunoRes.data) throw new Error("Cadastro de aluno não encontrado.");
    meuAlunoId=alunoRes.data.id; meuProfessorId=alunoRes.data.professor_id;
    meuNome=alunoRes.data.nome||""; meuTelefone=alunoRes.data.telefone||"";
    meuFotoUrl=alunoRes.data.foto_url||null;
    meuTreinoTipo=alunoRes.data.treino_tipo||"forca"; meuTreinoLocal=alunoRes.data.treino_local||"";
    meuEndereco=alunoRes.data.endereco||"";
    meuPlanoCobranca=alunoRes.data.plano_cobranca||""; meuValorAula=Number(alunoRes.data.valor_aula)||0;

    var sess=await sb.auth.getSession();
    meuEmail=(sess.data.session&&sess.data.session.user&&sess.data.session.user.email)||"";

    var res=await Promise.all([
      sb.from("aulas").select("id, data, hora, status, checkin_em, checkin_origem").eq("aluno_id", meuAlunoId),
      sb.from("profiles").select("nome, logo_url, pix, telefone").eq("id", meuProfessorId).maybeSingle()
    ]);
    if(res[0].error) throw res[0].error;
    if(res[1].error) throw res[1].error;
    aulas=(res[0].data||[]).map(function(r){ return {id:r.id,data:r.data,hora:(r.hora||"").slice(0,5),status:r.status,checkinEm:r.checkin_em||null,checkinOrigem:r.checkin_origem||null}; });
    var prof=res[1].data||{};
    nomePersonal=prof.nome||"Seu personal"; logoPersonal=prof.logo_url||null;
    pixPersonal=prof.pix||"(chave PIX não cadastrada)"; telefonePersonal=prof.telefone||"";

    // Solicitações reais (tolerante: se a tabela ainda não existir, não quebra o login).
    try {
      var sres = await sb.from("solicitacoes")
        .select("id, aula_id, tipo, data_sugerida, hora_sugerida, contra_data, contra_hora, status, created_at, resposta")
        .eq("aluno_id", meuAlunoId);
      minhasSolicitacoes = sres.error ? [] : (sres.data||[]).map(rowToSolic);
    } catch(e){ minhasSolicitacoes = []; }

    // Disponibilidade do personal (tolerante): só para exibir como dica ao pedir remarcação.
    try {
      var dres = await sb.from("disponibilidade_personal")
        .select("dia_semana, hora_inicio, hora_fim, ativo").eq("professor_id", meuProfessorId);
      dispPersonal = dres.error ? [] : (dres.data||[]).filter(function(d){return d.ativo!==false;})
        .map(function(d){ return { dia:d.dia_semana, ini:(d.hora_inicio||"").slice(0,5), fim:(d.hora_fim||"").slice(0,5) }; });
    } catch(e){ dispPersonal = []; }

    // Token de check-in (tolerante: só existe após a migração da Fase 5).
    try {
      var tkRes = await sb.from("alunos").select("checkin_token").eq("id", meuAlunoId).maybeSingle();
      meuCheckinToken = (tkRes.error || !tkRes.data) ? "" : (tkRes.data.checkin_token||"");
    } catch(e){ meuCheckinToken = ""; }

    // Tipo da chave Pix + cidade do personal (tolerante: só após a migração 0013).
    try {
      var pxRes = await sb.from("profiles").select("pix_tipo, cidade").eq("id", meuProfessorId).maybeSingle();
      if(!pxRes.error && pxRes.data){ pixTipoPersonal = pxRes.data.pix_tipo||""; cidadePersonal = pxRes.data.cidade||""; }
    } catch(e){ pixTipoPersonal=""; cidadePersonal=""; }

    // Cobranças reais (tolerante: se a tabela/policy ainda não existir, não quebra o login).
    try {
      var baseCols = "id, valor, referencia, periodo_label, status, data_vencimento, data_pagamento, aula_ids";
      var pres = await sb.from("pagamentos").select(baseCols+", pago_informado_em").eq("aluno_id", meuAlunoId);
      if(pres.error){ // coluna pode não existir antes da migração 0014
        pres = await sb.from("pagamentos").select(baseCols).eq("aluno_id", meuAlunoId);
      }
      minhasCobrancas = pres.error ? [] : (pres.data||[]).map(rowToPagamento);
    } catch(e){ minhasCobrancas = []; }

    // Avaliação física (tolerante: tabelas novas, podem ainda não existir
    // neste servidor se a migração 0007 do treinapp não tiver sido aplicada).
    try {
      var mcRes = await sb.from("metricas_catalogo").select("id, metrica_codigo, nome_exibicao, categoria, unidade_padrao")
        .order("categoria").order("nome_exibicao");
      metricasCatalogoAluno = mcRes.error ? [] : (mcRes.data||[]).map(function(r){
        return { id:r.id, codigo:r.metrica_codigo, nome:r.nome_exibicao, categoria:r.categoria, unidade:r.unidade_padrao };
      });
      var avRes = await sb.from("avaliacoes_fisicas").select("id, data_avaliacao, observacoes, aula_id, created_at")
        .eq("aluno_id", meuAlunoId).order("data_avaliacao", { ascending: false });
      minhasAvaliacoes = avRes.error ? [] : (avRes.data||[]).map(function(r){
        return { id:r.id, data:r.data_avaliacao, observacoes:r.observacoes||"", aulaId:r.aula_id||null, createdAt:r.created_at };
      });
      // Filtra explicitamente pelas próprias avaliações (defesa em profundidade
      // além da RLS, mesmo padrão já usado acima para aulas/pagamentos).
      var meusIdsAvaliacao = minhasAvaliacoes.map(function(a){ return a.id; });
      if (meusIdsAvaliacao.length){
        var aviRes = await sb.from("avaliacoes_fisicas_itens").select("id, avaliacao_id, metrica_id, valor, unidade")
          .in("avaliacao_id", meusIdsAvaliacao);
        minhasAvaliacoesItens = aviRes.error ? [] : (aviRes.data||[]).map(function(r){
          return { id:r.id, avaliacaoId:r.avaliacao_id, metricaId:r.metrica_id, valor:Number(r.valor), unidade:r.unidade };
        });
      } else {
        minhasAvaliacoesItens = [];
      }
    } catch(e){ metricasCatalogoAluno = []; minhasAvaliacoes = []; minhasAvaliacoesItens = []; }
  }
  function rowToPagamento(r){
    return { id:r.id, valor:Number(r.valor||0),
      label:r.periodo_label||r.referencia||"Cobrança",
      status:r.status||"pendente",
      vencimento:r.data_vencimento||null,
      pagamento:r.data_pagamento||null,
      pagoInformado: !!r.pago_informado_em,
      referencia:r.referencia||null,
      aulaIds: r.aula_ids||[] };
  }
  // Status efetivo de uma cobrança: pago / vencido / pendente.
  function statusCobranca(c){
    if(c.status==="pago") return "pago";
    if(c.vencimento && c.vencimento < HOJE_STR) return "vencido";
    return "pendente";
  }
  function rowToSolic(r){
    return { id:r.id, aulaId:r.aula_id, tipo:r.tipo,
      dataSugerida:r.data_sugerida, horaSugerida:(r.hora_sugerida||"").slice(0,5),
      contraData:r.contra_data, contraHora:(r.contra_hora||"").slice(0,5),
      status:r.status, createdAt:r.created_at, resposta:r.resposta||"" };
  }

  window.sairDaConta = function(){ sb.auth.signOut().then(function(){ location.reload(); }); };

  // rede de segurança
  setTimeout(function(){
    if(authEventJaProcessado) return;
    sb.auth.getSession().then(function(s){ resolverEstadoInicial(s.data.session); }).catch(function(err){
      console.error(err);
      if(!authEventJaProcessado){ authEventJaProcessado=true; mostrarGateAuth(); setErro("login-erro","Falha ao conectar no servidor. Tente recarregar a página."); }
    });
  }, 2000);

  /* =========================================================================
     Derivações a partir das aulas REAIS
     ========================================================================= */
  function aulaPassou(a){ return new Date(a.data+"T"+(a.hora||"00:00")+":00").getTime() <= Date.now(); }
  function ativa(a){ return a.status!=="cancelada" && a.status!=="remarcada"; }
  function ehProxima(a){ return (a.status==="agendada"||a.status==="confirmada") && !aulaPassou(a); }
  function ordAsc(x,y){ return (x.data+x.hora) < (y.data+y.hora) ? -1 : 1; }
  function ordDesc(x,y){ return (x.data+x.hora) > (y.data+y.hora) ? -1 : 1; }

  function proximasAulas(){ return aulas.filter(ehProxima).sort(ordAsc); }
  function labelStatusAula(st){
    if(st==="concluida") return "Concluída";
    if(st==="cancelada") return "Cancelada";
    if(st==="confirmada") return "Confirmada";
    return "Agendada";
  }
  // Enriquecimento visual do treino (por aluno): tipo/local vêm do cadastro.
  function labelTipo(t){
    if(t==="forca") return "Treino de Força";
    if(t==="funcional") return "Treino Funcional";
    if(t==="cardio") return "Treino de Cardio";
    return "Treino";
  }
  function enriquecer(a){
    return { id:a.id, data:a.data, hora:a.hora, status:a.status,
      titulo:labelTipo(meuTreinoTipo), sub:"Com "+esc(nomePersonal), local:esc(meuTreinoLocal), tipo:meuTreinoTipo,
      statusLabel:labelStatusAula(a.status), checkinEm:a.checkinEm, checkinOrigem:a.checkinOrigem };
  }
  function horaCheckin(iso){
    try{ return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}); }
    catch(e){ return ""; }
  }

  function segundaDaSemana(d){
    var x=new Date(d.getTime()); var dow=x.getDay(); var diff=(dow===0?-6:1-dow);
    x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x;
  }
  function derivarInicio(){
    var mes = HOJE_STR.slice(0,7);
    var noMes = aulas.filter(function(a){ return a.data.slice(0,7)===mes && ativa(a); });
    var realizadasMes = noMes.filter(function(a){ return a.status==="concluida"; }).length;
    var prox = proximasAulas();

    // semana (segunda a domingo)
    var seg = segundaDaSemana(HOJE); var dias=[]; var letras=["S","T","Q","Q","S","S","D"];
    var semAulas=0, semReal=0;
    for(var i=0;i<7;i++){
      var d=new Date(seg.getTime()); d.setDate(seg.getDate()+i); var ds=dataLocalStr(d);
      var daquele=aulas.filter(function(a){ return a.data===ds && ativa(a); });
      if(daquele.length){ semAulas++; if(daquele.some(function(a){return a.status==="concluida";})) semReal++; }
      dias.push({ l:letras[i], n:doisDig(d.getDate()), sel:ds===HOJE_STR, dot:daquele.length>0 });
    }

    // últimas atividades: a partir das aulas concluídas (real); fallback mock
    var atividades = aulas.filter(function(a){return a.status==="concluida";}).sort(ordDesc).slice(0,3).map(function(a){
      return { ic:"running", cor:"teal", titulo:"Treino realizado", sub:capitalizar(diaSemanaLabel(a.data))+", "+a.hora, quando:fmtDataBR(a.data).slice(0,5) };
    });

    return {
      proxima: prox[0] ? enriquecer(prox[0]) : null,
      aulasMes:{ v:realizadasMes, t:noMes.length },
      proximas: prox.length,
      semana:{ qtd:semAulas, realizadas:semReal, total:(semAulas||1), dias:dias,
               periodo: doisDig(seg.getDate())+"/"+doisDig(seg.getMonth()+1)+" - "+(function(){var f=new Date(seg.getTime());f.setDate(seg.getDate()+6);return doisDig(f.getDate())+"/"+doisDig(f.getMonth()+1);})() },
      solicitacoes: minhasSolicitacoes.filter(function(s){return s.status==="em_analise";}).length,
      atividades: atividades,
      progresso: MOCK.progresso
    };
  }

  /* =========================================================================
     ÍCONES / NAV / tipos de treino
     ========================================================================= */
  var IC = {
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>',
    aulas:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15l2 2 5-5"/></svg>',
    agenda:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 15h2M14 15h2"/></svg>',
    mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 7 8-7"/></svg>',
    financeiro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    chevL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    chevD:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    dumbbell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11M4 9l5-5M2 7l5-5M15 20l5-5M17 22l5-5"/></svg>',
    running:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="5" r="2"/><path d="M14 8l-3 3 2 3 1 5M11 11l-4 1-2 4M13 14l4 1 2 3"/></svg>',
    heart:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21s-7.5-4.6-10-9.3C.6 8.9 2 5.5 5.2 5.1 7 4.9 8.6 5.9 12 9c3.4-3.1 5-4.1 6.8-3.9C22 5.5 23.4 8.9 22 11.7 19.5 16.4 12 21 12 21z"/></svg>',
    trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v3a6 6 0 0 1-12 0V4z"/><path d="M6 6H3v1a3 3 0 0 0 3 3M18 6h3v1a3 3 0 0 1-3 3M9 15h6M8 20h8M10 15l-.5 5M14 15l.5 5"/></svg>',
    // Ícones da avaliação física: desenhos próprios, mesmo estilo de traço do
    // restante do app — inspirados no mockup aprovado, não extraídos dele.
    // Pacote de ícones oficial (LT360_Icones_Avaliacao_Fisica) — SVGs originais,
    // reutilizados como vieram (currentColor, stroke-width 1.8).
    pesoM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 0 1 8 0"/><path d="M6 7h12l3 13H3L6 7Z"/><path d="m12 10 2 3-2 2"/></svg>',
    alturaM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M4 6l3-3 3 3M4 18l3 3 3-3"/><path d="M13 4h7M13 9h4M13 14h7M13 19h4"/></svg>',
    bracoM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c2-1 3-4 5-5l2-2 2 2 2-4c.6-1.4 2.7-1.2 3 .3l-1 6c-.6 3-3.5 5-7 5H5Z"/><path d="M9 13c1 1 2 2 4 2"/></svg>',
    coxaM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h9l1 6-3 5-2 7h-5l1-9-2-5Z"/><path d="M8 9h9"/></svg>',
    panturrilhaM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3c-1 4-2 6-1 9l2 3-1 6h5l1-6 2-4-1-8"/><path d="M8 12c3 2 5 2 8-1"/></svg>',
    cinturaM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3c1 4 2 5 2 9s-1 5-2 9M18 3c-1 4-2 5-2 9s1 5 2 9"/><path d="M8 9c2 1 6 1 8 0M8 15c2-1 6-1 8 0"/></svg>',
    peitoralM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4 3 10l4 11h10l4-11-2-6-5 3-2 4-2-4Z"/><path d="M12 11v10"/></svg>',
    abdomenM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3 5 9l2 12h10l2-12-2-6"/><path d="M9 8h6M9 12h6M9 16h6M12 8v12"/></svg>',
    gorduraM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-3 5-7 8-7 12a7 7 0 0 0 14 0c0-4-4-7-7-12Z"/><path d="M9 16l6-6"/><circle cx="9" cy="11" r=".8"/><circle cx="15" cy="16" r=".8"/></svg>',
    // Genéricos: usados só quando não há ícone específico no pacote (ex.: quadril, métricas custom).
    percentM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7.5" r="2.3"/><circle cx="17" cy="16.5" r="2.3"/><path d="M18 6 6 18"/></svg>',
    perimetroM:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 3.3V6M12 18v2.7M3.3 12H6M18 12h2.7"/></svg>',
    grafico:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M12 19V5M20 19v-7"/><path d="M4 19h16"/></svg>',
    layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
    box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
    arrowDown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    pix:'<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l3.2 3.2a2 2 0 0 0 1.4.6H18L21.5 9.8a2 2 0 0 1 0 2.8L18 16.1h-1.4a2 2 0 0 0-1.4.6L12 20.9l-3.2-3.2a2 2 0 0 0-1.4-.6H6L2.5 13.6a2 2 0 0 1 0-2.8L6 7.3h1.4a2 2 0 0 0 1.4-.6L12 2.5z"/></svg>',
    whats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19 3 22l5-2a9 9 0 1 0-3-3z"/><path d="M9 8c1 4 3 6 7 7"/></svg>',
    logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    // Pacote de ícones da Proposta 2 (LT360_Icones) — SVGs originais, reutilizados como vieram.
    copiar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    checkCirc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></svg>',
    xcirc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/></svg>',
    navAvaliacao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4M16 5h4v2a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6"/></svg>',
    treino:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="4" r="2"/><path d="m13 8-4 4 4 3 1 6M13 8l4 3 4-1M9 12l-5 2M9 15l-4 5"/></svg>',
    emAnalise:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
    reposicao:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8a8 8 0 0 0-14-2L3 9M3 4v5h5M4 16a8 8 0 0 0 14 2l3-3M21 20v-5h-5"/></svg>'
  };
  var NAV = [
    {id:"inicio",label:"Início",ic:"home"},{id:"aulas",label:"Aulas",ic:"aulas"},
    {id:"agenda",label:"Agenda",ic:"agenda"},{id:"solicitacoes",label:"Solicitações",ic:"mail"},
    {id:"financeiro",label:"Financeiro",ic:"financeiro"},{id:"avaliacao",label:"Avaliação",ic:"navAvaliacao"}
  ];
  var TIPO = { forca:{ic:"dumbbell",tile:"tile-graf"}, funcional:{ic:"treino",tile:"tile-teal"}, cardio:{ic:"heart",tile:"tile-vermelho"} };

  /* =========================================================================
     Shell (sidebar, bottom nav, header mobile)
     ========================================================================= */
  /* ---------------- Notificações (sino) ---------------------------------- */
  function listaNotificacoes(){
    var ns=[];
    var venc = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="vencido"; });
    if(venc.length){ ns.push({ ic:"box", cor:"red", titulo: venc.length+" cobrança"+(venc.length>1?"s":"")+" vencida"+(venc.length>1?"s":""), sub:"Toque para ver no Financeiro.", tab:"financeiro" }); }
    var contra = minhasSolicitacoes.filter(function(s){ return s.status==="contraproposta"; });
    if(contra.length){ ns.push({ ic:"agenda", cor:"amber", titulo:"Seu personal sugeriu um novo horário", sub:"Responda em Solicitações.", tab:"solicitacoes" }); }
    return ns;
  }
  function aplicarSino(btn){
    if(!btn) return;
    btn.innerHTML = IC.bell;
    if(listaNotificacoes().length) btn.classList.add("has-dot"); else btn.classList.remove("has-dot");
    btn.onclick = window.abrirNotificacoes;
  }
  window.abrirNotificacoes = function(){
    var ns = listaNotificacoes();
    var corpo = ns.length
      ? ns.map(function(x){ return '<button class="notif-row" onclick="irDeNotif(\''+x.tab+'\')"><span class="notif-ic '+x.cor+'">'+IC[x.ic]+'</span><div class="notif-txt"><div class="notif-t">'+x.titulo+'</div><div class="notif-s">'+x.sub+'</div></div><span class="chev">'+IC.chevR+'</span></button>'; }).join("")
      : '<div class="notif-vazio"><span class="notif-vazio-ic">'+IC.check+'</span>Tudo em dia! Sem novidades por aqui.</div>';
    abrirModal('<div class="notif-modal"><div class="modal-tit">Notificações</div><div class="notif-lista">'+corpo+'</div><div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div></div>');
  };
  window.irDeNotif = function(tab){ document.getElementById("modal-overlay").hidden=true; ir(tab); };

  function renderShell(){
    aplicarSino(document.getElementById("btn-bell"));
    var _ta=document.getElementById("topbar-avatar"); if(_ta) _ta.innerHTML=avatarInner();
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){
      return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>';
    }).join("");
    document.getElementById("sidebar-foot").innerHTML =
      '<button class="perfil-link" onclick="ir(\'perfil\')"><span class="avatar avatar-foto">'+avatarInner()+'</span>'+
        '<span class="perfil-link-txt"><b>'+esc(meuNome)+'</b><span>Ver perfil '+IC.chevR+'</span></span></button>'+
      '<div class="personal-box"><div class="personal-cap">Seu personal</div>'+
        '<div class="personal-row">'+logoPersonalBox()+
        '<span class="personal-txt"><b>'+esc(nomePersonal)+'</b><span>Personal Trainer</span></span></div></div>';
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){
      return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>';
    }).join("");
    renderMHeader();
    renderDrawer();
  }
  var NDBURGER='<button class="nd-burger" type="button" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav-drawer" onclick="abrirMenu()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>';
  function renderMHeader(){
    var el=document.getElementById("m-header");
    if(tabAtual==="inicio"){
      el.className="m-header m-header-inicio";
      el.innerHTML='<img class="logo-img logo-img-m" src="/logo_lt360.png" alt="LT360">'+
        '<div class="m-header-right"><button class="icon-btn'+(listaNotificacoes().length?' has-dot':'')+'" aria-label="Notificações" onclick="abrirNotificacoes()">'+IC.bell+'</button>'+
        '<div class="avatar avatar-sm" onclick="ir(\'perfil\')">'+avatarInner()+'</div>'+NDBURGER+'</div>';
    } else {
      el.className="m-header m-header-titulo";
      var lbl = tabAtual==="perfil" ? "Meu perfil" : (NAV.filter(function(n){return n.id===tabAtual;})[0]||{label:""}).label;
      el.innerHTML='<h1 class="m-title">'+lbl+'</h1>'+NDBURGER;
    }
  }
  function renderDrawer(){
    var nav=document.getElementById("nd-nav");
    if(nav){
      nav.innerHTML = NAV.map(function(n){
        return '<button class="nd-item'+(n.id===tabAtual?' active':'')+'" data-tab="'+n.id+'" onclick="ir(\''+n.id+'\')"><span class="nd-ic">'+IC[n.ic]+'</span>'+n.label+'</button>';
      }).join("") +
      '<button class="nd-item'+(tabAtual==="perfil"?' active':'')+'" data-tab="perfil" onclick="ir(\'perfil\')"><span class="nd-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span>Meu perfil</button>';
    }
    var foot=document.getElementById("nd-foot");
    if(foot){
      foot.innerHTML =
        '<button class="nd-user" onclick="ir(\'perfil\')"><span class="avatar avatar-sm">'+avatarInner()+'</span>'+
          '<span class="nd-user-txt"><b>'+esc(meuNome||"Aluno")+'</b><span>'+esc(nomePersonal)+' · Personal</span></span></button>'+
        '<button class="nd-sair" onclick="sairDaConta()">'+IC.logout+' Sair da conta</button>';
    }
  }

  /* ---------------- componentes ------------------------------------------- */
  function statusBadge(st){
    var cls="ok";
    if(st==="Em análise"||st==="Pendente") cls="warn";
    else if(st==="Negada"||st==="Cancelada") cls="dang";
    return '<span class="badge badge-'+cls+'">'+st+'</span>';
  }
  function tileTreino(tipo, outline){ var t=TIPO[tipo]||TIPO.forca; return '<span class="treino-tile '+(outline?"tile-outline":t.tile)+'">'+IC[t.ic]+'</span>'; }
  // Cabeçalho premium (hero) de cada tela: título + subtítulo + arte à direita,
  // envolvendo o conteúdo funcional que o mockup mostra logo abaixo do subtítulo
  // (abas, indicadores ou aviso — passado em extraHtml). Título/subtítulo/arte
  // só aparecem no desktop (no mobile o título é o m-header genérico); extraHtml
  // aparece sempre, nas duas resoluções.
  // As 4 telas já usam a fotografia final (hero-*.webp).
  function screenHero(titulo, subtitulo, imgSrc, extraHtml){
    return '<div class="screen-hero"><div class="screen-hero-art"><img src="'+esc(imgSrc)+'" alt="" aria-hidden="true"></div>'+
      '<div class="screen-hero-inner only-desktop"><div class="screen-hero-text"><h1>'+esc(titulo)+'</h1>'+
      (subtitulo ? '<div class="cobr-det">'+esc(subtitulo)+'</div>' : '')+'</div></div>'+
      (extraHtml ? '<div class="screen-hero-extra">'+extraHtml+'</div>' : '')+
      '</div>';
  }
  function statMiniCard(ic,cls,val,cap){
    return '<div class="card stat-card"><span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="stat-txt"><span class="stat-cap">'+cap+'</span><span class="stat-val">'+val+'</span></div></div>';
  }
  function cardAula(a, comLocal){
    var selo = (a.checkinOrigem==="checkout")
      ? '<div class="aula-item-checkout">'+IC.check+' Concluída via check-out'+(a.checkinEm?' · '+horaCheckin(a.checkinEm):'')+'</div>'
      : '';
    return '<div class="aula-item">'+tileTreino(a.tipo)+
      '<div class="aula-item-info"><div class="aula-item-hora">'+a.hora+'</div>'+
      '<div class="aula-item-tit">'+a.titulo+'</div><div class="aula-item-sub">'+a.sub+'</div>'+
      (comLocal&&a.local?'<div class="aula-item-local">'+IC.pin+esc(a.local)+'</div>':'')+selo+'</div>'+
      '<div class="aula-item-dir">'+statusBadge(a.statusLabel)+'<span class="chev">'+IC.chevR+'</span></div></div>';
  }

  /* =========================================================================
     TELA: Início
     ========================================================================= */
  function screenInicio(){
    var D=derivarInicio();
    var proxima = D.proxima
      ? '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span>'+statusBadge(D.proxima.statusLabel)+'</div>'+
          '<div class="prox-main">'+tileTreino(D.proxima.tipo)+
            '<div class="prox-info"><div class="prox-dh"><span class="dh-long">'+capitalizar(diaSemanaLabel(D.proxima.data))+', '+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span>'+
              '<span class="dh-short">'+fmtDataBR(D.proxima.data).slice(0,5)+' • '+D.proxima.hora+'</span></div>'+
              '<div class="prox-tit">'+D.proxima.titulo+'</div><div class="prox-sub">'+D.proxima.sub+'</div>'+
              (D.proxima.local?'<div class="prox-local">'+IC.pin+esc(D.proxima.local)+'</div>':'')+'</div>'+
            '<span class="chev chev-lg">'+IC.chevR+'</span></div>'+
          '<div class="prox-acoes"><button class="btn btn-primary" onclick="verDetalhesAula(\''+D.proxima.id+'\')">Ver detalhes</button>'+
            '<button class="btn btn-dark" onclick="solicitarRemarcacao(\''+D.proxima.id+'\')">Remarcar</button>'+
            '<button class="btn btn-dang" onclick="solicitarCancelamento(\''+D.proxima.id+'\')">Cancelar</button></div></div>'
      : '<div class="card prox-card"><div class="prox-head"><span class="prox-cap">PRÓXIMA AULA</span></div>'+
          '<div class="lista-vazia" style="padding:14px 2px">Você não tem aulas agendadas no momento.</div></div>';

    var s=D.semana; var pct = s.total? Math.round(s.realizadas/s.total*100):0;
    var semana='<div class="card semana-card"><div class="semana-top">'+
      '<div><div class="semana-cap">Sua semana</div><div class="semana-n">'+s.qtd+' aulas</div><div class="semana-per">'+s.periodo+'</div></div>'+
      '<div class="ring" style="--pct:'+pct+'"><div class="ring-in"><b>'+s.realizadas+'/'+s.total+'</b><span>aulas realizadas</span></div></div></div>'+
      '<div class="semana-dias">'+s.dias.map(function(d){ return '<div class="sd"><span class="sd-l">'+d.l+'</span><span class="sd-n'+(d.sel?' sel':'')+'">'+d.n+'</span><span class="sd-dot'+(d.dot?' on':'')+'"></span></div>'; }).join("")+'</div></div>';

    function statCard(cls,ic,cap,val,extra){ return '<div class="card stat-card"><span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="stat-txt"><span class="stat-cap">'+cap+'</span><span class="stat-val">'+val+'</span>'+(extra||"")+'</div></div>'; }
    var barra = D.aulasMes.t ? Math.round(D.aulasMes.v/D.aulasMes.t*100) : 0;
    var stats='<div class="stat-row">'+
      statCard("si-teal","agenda","Aulas do mês",D.aulasMes.v+'<span class="stat-sm">/'+D.aulasMes.t+'</span>','<div class="stat-bar"><span style="width:'+barra+'%"></span></div>')+
      statCard("si-azul","running","Próximas aulas",String(D.proximas),'<span class="stat-foot">agendadas</span>')+
      statCard("si-verde","box",'<span>Financeiro</span>','<span class="verde">Em dia</span> <span class="mini-check">'+IC.check+'</span>',"")+
      statCard("si-amber","trophy","Solicitações",String(D.solicitacoes),'<span class="stat-foot">em análise <span class="mini-clock">'+IC.clock+'</span></span>')+
      '</div>';

    var atividades='<div class="card lista-card"><div class="card-head"><h3>Últimas atividades</h3><button class="link" onclick="toast(\'Em breve\')">Ver todas</button></div>'+
      (D.atividades.length ? D.atividades.map(function(a){ return '<div class="ativ-row"><span class="ativ-ic '+a.cor+'">'+IC[a.ic]+'</span><div class="ativ-info"><div class="ativ-tit">'+a.titulo+'</div><div class="ativ-sub">'+a.sub+'</div></div><div class="ativ-dir"><span>'+a.quando+'</span>'+IC.chevR+'</div></div>'; }).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Sem atividades recentes.</div>')+'</div>';

    var pr=D.progresso;
    var progresso='<div class="card lista-card"><div class="card-head"><h3>Meu progresso</h3><button class="link" onclick="toast(\'Em breve\')">Ver evolução</button></div>'+
      '<div class="prog-grid"><div class="prog-col"><div class="prog-cap">Peso atual '+IC.chevR+'</div><div class="prog-val">'+pr.peso+(pr.peso!=="—"?' <span>kg</span>':'')+'</div>'+
        '<div class="prog-foot">registre no app (em breve)</div></div>'+
      '<div class="prog-col"><div class="prog-cap">Aulas realizadas '+IC.chevR+'</div><div class="prog-val">'+(aulas.filter(function(a){return a.status==="concluida";}).length)+'</div><div class="prog-foot">no total</div></div></div></div>';

    var heroBtn = meuCheckinToken
      ? '<button class="btn btn-checkin" onclick="abrirCheckin()">'+IC.box+' Meu check-out</button>'
      : '';
    return '<div class="hero"><div class="hero-txt"><h1>Olá, '+esc(meuNome.split(" ")[0]||"aluno")+'!</h1><p>Vamos em busca de mais resultados! 💪</p></div>'+heroBtn+'</div>'+
      '<div class="grid-prox">'+proxima+semana+'</div>'+stats+'<div class="grid-2">'+atividades+progresso+'</div>';
  }
  window.abrirCheckin = async function(){
    if(!meuCheckinToken){ toast("Check-in indisponível. Atualize o app ou fale com seu personal."); return; }
    var svg;
    try{
      svg = await QRCode.toString("LT360CHECKIN:"+meuCheckinToken, { type:"svg", margin:1, errorCorrectionLevel:"M" });
    }catch(e){ console.error(e); toast("Não foi possível gerar o QR."); return; }
    var html='<div class="checkin-modal">'+
      '<div class="modal-tit">Meu check-out</div>'+
      '<div class="modal-sub">Mostre este QR ao seu personal para finalizar a aula de hoje.</div>'+
      '<div class="qr-panel">'+svg+'</div>'+
      '<div class="qr-nome">'+esc(meuNome)+'</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div>'+
      '</div>';
    abrirModal(html);
  };

  /* =========================================================================
     TELA: Aulas (próximas / realizadas / canceladas) — real
     ========================================================================= */
  function listaAulasPorTab(){
    var arr;
    if(aulasTab==="realizadas") arr=aulas.filter(function(a){ return a.status==="concluida"; }).sort(ordDesc);
    else if(aulasTab==="canceladas") arr=aulas.filter(function(a){ return a.status==="cancelada"; }).sort(ordDesc);
    else arr=proximasAulas();
    return arr.map(enriquecer);
  }
  window.setAulasTab = function(t){ aulasTab=t; ir("aulas"); };
  // "Faltam Xh Ymin" — só quando a data/hora da aula é confiável e ainda não passou.
  function faltamTexto(a){
    var alvo=new Date(a.data+"T"+(a.hora||"00:00")+":00").getTime();
    if(isNaN(alvo)) return null;
    var diff=alvo-Date.now();
    if(diff<=0) return null;
    var totalMin=Math.floor(diff/60000);
    var h=Math.floor(totalMin/60), m=totalMin%60;
    return (h>0?h+"h ":"")+m+"min";
  }
  function cardProximaAulaDestaque(a){
    var faltam=faltamTexto(a);
    return '<div class="card prox-aula-dest"><div class="prox-head"><span class="prox-cap prox-cap-chip">PRÓXIMA AULA</span></div>'+
      '<div class="prox-aula-main"><div class="prox-aula-left">'+tileTreino(a.tipo)+
        '<div class="prox-info"><div class="prox-dh"><span class="dh-long">'+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+', '+fmtDataBR(a.data)+'<span class="prox-dh-sep">|</span><span class="prox-dh-clock">'+IC.clock+'</span>'+a.hora+'</span>'+
        '<span class="dh-short">'+fmtDataBR(a.data).slice(0,5)+' • '+a.hora+'</span></div>'+
        '<div class="prox-tit">'+a.titulo+'</div><div class="prox-sub">'+a.sub+'</div>'+
        (a.local?'<div class="prox-local">'+IC.pin+esc(a.local)+'</div>':'')+'</div></div>'+
        '<div class="prox-aula-right">'+
        (faltam?'<div class="prox-aula-faltam"><span class="prox-aula-faltam-cap">'+IC.clock+'Faltam</span><span class="prox-aula-faltam-val" id="prox-aula-countdown" data-aula-data="'+a.data+'" data-aula-hora="'+a.hora+'">'+faltam+'</span></div>':'')+
        '<button class="btn btn-outline btn-sm" onclick="verDetalhesAula(\''+a.id+'\')">Ver detalhes '+IC.chevR+'</button></div></div></div>';
  }
  function pararCountdownAulas(){ if(aulasCountdownTimer){ clearInterval(aulasCountdownTimer); aulasCountdownTimer=null; } }
  function iniciarCountdownAulas(){
    pararCountdownAulas();
    if(!document.getElementById("prox-aula-countdown")) return;
    aulasCountdownTimer=setInterval(function(){
      var el=document.getElementById("prox-aula-countdown");
      if(!el){ pararCountdownAulas(); return; }
      var alvo=new Date(el.getAttribute("data-aula-data")+"T"+el.getAttribute("data-aula-hora")+":00").getTime();
      var diff=alvo-Date.now();
      if(diff<=0){ el.textContent="Agora"; pararCountdownAulas(); return; }
      var totalMin=Math.floor(diff/60000);
      var h=Math.floor(totalMin/60), m=totalMin%60;
      el.textContent=(h>0?h+"h ":"")+m+"min";
    }, 30000);
  }
  // Variante compacta de cardAula com data+hora dentro do próprio card (sem
  // cabeçalho de dia acima) — conforme a referência de Aulas/Agenda-Lista.
  // cardAula (com agrupamento por dia) continua intacto para onde já era usado.
  function cardAulaLista(a){
    var selo = (a.checkinOrigem==="checkout")
      ? '<div class="aula-item-checkout">'+IC.check+' Concluída via check-out'+(a.checkinEm?' · '+horaCheckin(a.checkinEm):'')+'</div>'
      : '';
    return '<div class="aula-item">'+tileTreino(a.tipo)+
      '<div class="aula-item-info"><div class="aula-item-hora"><span class="dh-long">'+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+', '+fmtDataBR(a.data)+' · '+a.hora+'</span>'+
      '<span class="dh-short">'+fmtDataBR(a.data).slice(0,5)+' · '+a.hora+'</span></div>'+
      '<div class="aula-item-tit">'+a.titulo+'</div><div class="aula-item-sub">'+a.sub+'</div>'+
      (a.local?'<div class="aula-item-local">'+IC.pin+esc(a.local)+'</div>':'')+selo+'</div>'+
      '<div class="aula-item-dir">'+statusBadge(a.statusLabel)+'<span class="chev">'+IC.chevR+'</span></div></div>';
  }
  function screenAulas(){
    var lista=listaAulasPorTab();
    var tabs='<div class="seg">'+
      '<button class="seg-b'+(aulasTab==="proximas"?" active":"")+'" onclick="setAulasTab(\'proximas\')">Próximas</button>'+
      '<button class="seg-b'+(aulasTab==="realizadas"?" active":"")+'" onclick="setAulasTab(\'realizadas\')">Realizadas</button>'+
      '<button class="seg-b'+(aulasTab==="canceladas"?" active":"")+'" onclick="setAulasTab(\'canceladas\')">Canceladas</button></div>';
    var destaque="";
    if(aulasTab==="proximas" && lista.length){ destaque=cardProximaAulaDestaque(lista[0]); lista=lista.slice(1); }
    var subtit = (destaque && lista.length) ? '<div class="aulas-subtit">Próximas aulas</div>' : "";
    var corpo = lista.length ? lista.map(cardAulaLista).join("")
      : (destaque ? "" : '<div class="lista-vazia">Nenhuma aula nesta lista.</div>');
    return screenHero("Aulas","Organize seus treinos e acompanhe suas próximas aulas.","/img/hero-aulas.webp",tabs)+destaque+subtit+corpo;
  }

  /* =========================================================================
     TELA: Agenda — calendário do mês atual + detalhe do dia (real)
     ========================================================================= */
  function diasComAula(mesPrefix){
    var set={}; aulas.forEach(function(a){ if(a.data.slice(0,7)===mesPrefix && ativa(a)) set[parseInt(a.data.slice(8),10)]=true; }); return set;
  }
  window.selecionarDiaAgenda = function(ds){ agendaSel=ds; ir("agenda"); };
  window.setAgendaView = function(v){ agendaView=v; ir("agenda"); };
  window.agendaNav = function(dir){
    if(agendaView==="semana"){ agendaSel = addDias(agendaSel, dir*7); }
    else { var d=new Date(agendaAno, agendaMes+dir, 1); agendaAno=d.getFullYear(); agendaMes=d.getMonth(); }
    ir("agenda");
  };
  function addDias(ds, n){ var p=ds.split("-"); var d=new Date(+p[0], +p[1]-1, +p[2]); d.setDate(d.getDate()+n); return dataLocalStr(d); }
  function aulasDoDia(ds){ return aulas.filter(function(a){ return a.data===ds && ativa(a); }).sort(ordAsc).map(enriquecer); }
  // Card do painel "Aulas do dia" (Agenda, visão Mês): tile outline e badge de
  // status. (O antigo link "Ver detalhes" foi removido por não ter função.)
  function cardAulaDetalheDia(a){
    return '<div class="agenda-dia-item">'+tileTreino(a.tipo,true)+
      '<div class="agenda-dia-info"><div class="agenda-dia-hora">'+a.hora+'</div>'+
      '<div class="agenda-dia-tit">'+a.titulo+'</div><div class="agenda-dia-sub">'+a.sub+'</div></div>'+
      '<div class="agenda-dia-dir">'+statusBadge(a.statusLabel)+'</div></div>';
  }
  function blocoDetalheDia(ds){
    var doDia = aulasDoDia(ds);
    return '<div class="agenda-det-dia">'+capitalizar(diaSemanaLabel(ds))+', '+fmtDataBR(ds)+'</div>'+
      (doDia.length ? doDia.map(cardAulaDetalheDia).join("")
        : '<div class="lista-vazia" style="padding:12px 2px">Nenhuma aula neste dia.</div>');
  }
  function calLabel(){
    if(agendaView==="semana"){
      var ini=addDias(agendaSel, -(new Date(agendaSel.split("-")[0],agendaSel.split("-")[1]-1,agendaSel.split("-")[2]).getDay()));
      var fim=addDias(ini,6);
      return fmtDataBR(ini).slice(0,5)+" – "+fmtDataBR(fim).slice(0,5);
    }
    return capitalizar(MESES[agendaMes])+' de '+agendaAno;
  }
  // Resumo do mês exibido na Agenda — contagens reais do mês em exibição
  // (não é frequência/percentual: não há base confiável para calcular isso).
  function resumoItemAgenda(ic,cls,val,cap){
    return '<div class="resumo-item"><span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="resumo-item-txt"><b>'+val+'</b><span>'+cap+'</span></div></div>';
  }
  function blocoResumoMes(){
    var mesPrefix = agendaAno+"-"+doisDig(agendaMes+1);
    var doMes = aulas.filter(function(a){ return a.data.slice(0,7)===mesPrefix; });
    var agendadas = doMes.filter(function(a){ return a.status==="agendada"||a.status==="confirmada"; }).length;
    var realizadas = doMes.filter(function(a){ return a.status==="concluida"; }).length;
    var canceladas = doMes.filter(function(a){ return a.status==="cancelada"; }).length;
    return '<div class="card agenda-resumo"><div class="card-head"><h3>Resumo do mês</h3></div>'+
      '<div class="resumo-grid">'+
        resumoItemAgenda("agenda","si-teal",agendadas,"Aulas agendadas")+
        resumoItemAgenda("check","si-verde",realizadas,"Aulas realizadas")+
        resumoItemAgenda("xcirc","si-dang",canceladas,"Aulas canceladas")+
      '</div></div>';
  }
  function screenAgenda(){
    var nav='<div class="cal-nav"><button class="cal-arrow" onclick="agendaNav(-1)">'+IC.chevL+'</button>'+
      '<span class="cal-mes">'+calLabel()+'</span>'+
      '<button class="cal-arrow" onclick="agendaNav(1)">'+IC.chevR+'</button></div>';

    var corpo;
    if(agendaView==="lista"){
      var mesPrefixL = agendaAno+"-"+doisDig(agendaMes+1);
      var doMes = aulas.filter(function(a){ return a.data.slice(0,7)===mesPrefixL && ativa(a); }).sort(ordAsc).map(enriquecer);
      corpo = doMes.length ? doMes.map(cardAulaLista).join("") : '<div class="lista-vazia">Nenhuma aula neste mês.</div>';
      corpo = '<div class="card agenda-det">'+nav+corpo+'</div>';
    } else if(agendaView==="semana"){
      var p=agendaSel.split("-"); var inicioSemana=addDias(agendaSel, -(new Date(+p[0],+p[1]-1,+p[2]).getDay()));
      var dias=[]; for(var k=0;k<7;k++) dias.push(addDias(inicioSemana,k));
      var blocos=dias.map(function(ds){
        var aa=aulasDoDia(ds);
        return '<div class="sem-dia'+(ds===HOJE_STR?' hoje':'')+'"><div class="grupo-dia">'+capitalizar(diaSemanaLabel(ds)).slice(0,3)+', '+fmtDataBR(ds).slice(0,5)+'</div>'+
          (aa.length ? aa.map(function(a){return cardAula(a,true);}).join("") : '<div class="sem-vazio">—</div>')+'</div>';
      }).join("");
      corpo='<div class="card agenda-det">'+nav+blocos+'</div>';
    } else {
      // Mês (calendário + detalhe do dia)
      var mesPrefix = agendaAno+"-"+doisDig(agendaMes+1);
      var primeiro = new Date(agendaAno,agendaMes,1).getDay();
      var diasNoMes = new Date(agendaAno,agendaMes+1,0).getDate();
      var dots=diasComAula(mesPrefix);
      var cells=[]; for(var i=0;i<primeiro;i++) cells.push(null); for(var d=1;d<=diasNoMes;d++) cells.push(d);
      while(cells.length%7) cells.push(null);
      var wk=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
      var cal=nav+'<div class="cal-head">'+wk.map(function(w){return '<span>'+w+'</span>';}).join("")+'</div>'+
        '<div class="cal-grid">'+cells.map(function(d){
          if(d===null) return '<span class="cal-cell empty"></span>';
          var ds=mesPrefix+"-"+doisDig(d); var sel=ds===agendaSel; var dot=dots[d];
          return '<span class="cal-cell'+(sel?' sel':'')+'" onclick="selecionarDiaAgenda(\''+ds+'\')"><span class="cal-n">'+d+'</span>'+(dot?'<span class="cal-dot teal"></span>':'')+'</span>';
        }).join("")+'</div>';
      corpo='<div class="agenda-cal card">'+cal+'</div><div class="agenda-lado"><div class="agenda-lado-det card agenda-det">'+blocoDetalheDia(agendaSel)+'</div>'+blocoResumoMes()+'</div>';
    }

    function segAg(id,rot){ return '<button class="seg-b'+(agendaView===id?" active":"")+'" onclick="setAgendaView(\''+id+'\')">'+rot+'</button>'; }
    var seg='<div class="seg seg-agenda">'+segAg("mes","Mês")+segAg("semana","Semana")+segAg("lista","Lista")+'</div>';

    var wrapCls = agendaView==="mes" ? "agenda-wrap" : "agenda-wrap ag-full";
    return screenHero("Agenda","Visualize todas as suas aulas e compromissos.","/img/hero-agenda.webp",seg)+
      '<div class="'+wrapCls+'">'+corpo+'</div>';
  }

  /* =========================================================================
     TELA: Solicitações (mock — Fase 3)
     ========================================================================= */
  function labelStatusSolic(st){
    if(st==="aprovada")return"Aprovada"; if(st==="negada")return"Negada";
    if(st==="contraproposta")return"Horário sugerido"; return"Em análise";
  }
  function badgeSolic(st){
    var cls="warn";
    if(st==="aprovada")cls="ok"; else if(st==="negada")cls="dang"; else if(st==="contraproposta")cls="info";
    return '<span class="badge badge-'+cls+'">'+labelStatusSolic(st)+'</span>';
  }
  // Ícone identifica o TIPO da solicitação; a cor do círculo identifica o STATUS
  // (conforme a referência aprovada) — as duas informações continuam visíveis
  // junto com o texto (título + badge), nada fica só na cor.
  function visualSolic(s){ return s.tipo==="remarcar" ? {titulo:"Remarcação de aula",ic:"agenda"} : {titulo:"Cancelamento de aula",ic:"reposicao"}; }
  function corSolicStatus(st){
    if(st==="aprovada") return "green";
    if(st==="negada") return "red";
    return "blue"; // em_analise, contraproposta
  }
  // curto=true usa data abreviada (sem dia da semana) para caber em telas
  // estreitas — mesmo padrão já usado em Aulas/Agenda.
  function quandoSolic(s, curto){
    if(s.tipo==="remarcar" && s.dataSugerida){
      var dia = curto ? fmtDataBR(s.dataSugerida).slice(0,5) : capitalizar(diaSemanaLabel(s.dataSugerida)).slice(0,3)+", "+fmtDataBR(s.dataSugerida).slice(0,5);
      return "Pedido: "+dia+(s.horaSugerida?" • "+s.horaSugerida:"");
    }
    var a=getAula(s.aulaId);
    if(a){
      var dia = curto ? fmtDataBR(a.data).slice(0,5) : capitalizar(diaSemanaLabel(a.data)).slice(0,3)+", "+fmtDataBR(a.data).slice(0,5);
      return dia+" • "+a.hora;
    }
    return "";
  }
  function waLink(tel, msg){ var d=(tel||"").replace(/\D/g,""); if(d.length<=11) d="55"+d; return "https://wa.me/"+d+"?text="+encodeURIComponent(msg); }
  function waPersonalBtn(){
    if(!telefonePersonal) return "";
    var msg="Olá "+((nomePersonal||"").split(" ")[0])+"! Sobre minha solicitação no portal LT360...";
    return '<a class="btn btn-wa" href="'+waLink(telefonePersonal,msg)+'" target="_blank" rel="noopener">'+IC.whats+' WhatsApp</a>';
  }
  function cardSolicitacao(s){
    var v=visualSolic(s);
    var cor=corSolicStatus(s.status);
    var topo='<div class="solic-card">'+
      '<span class="solic-ic '+cor+'">'+IC[v.ic]+'</span>'+
      '<div class="solic-info"><div class="solic-tit">'+v.titulo+'</div>'+
      '<div class="solic-quando"><span class="dh-long">'+quandoSolic(s)+'</span><span class="dh-short">'+quandoSolic(s,true)+'</span></div>'+
      '<div class="solic-sol">Solicitado em '+fmtDataBR((s.createdAt||HOJE_STR).slice(0,10))+'</div></div>'+
      '<div class="solic-dir">'+badgeSolic(s.status)+'<span class="chev">'+IC.chevR+'</span></div></div>';
    var extra="";
    // O botão de WhatsApp do topo (CTA) já cobre o contato geral — manter um
    // 2º botão igual em cada card "em_analise" duplicava a mesma ação na tela.
    // No fluxo de contraproposta o botão continua: ali ele é contextual à
    // negociação do novo horário, não uma repetição do CTA do topo.
    if(s.status==="contraproposta"){
      extra='<div class="solic-contra">'+
        '<div class="solic-contra-txt">Seu personal sugeriu: <b>'+capitalizar(diaSemanaLabel(s.contraData)).slice(0,3)+', '+fmtDataBR(s.contraData).slice(0,5)+' • '+s.contraHora+'</b></div>'+
        '<div class="solic-contra-botoes">'+ waPersonalBtn() +
          '<button class="btn btn-dark" onclick="responderContra(\''+s.id+'\',false)">Recusar</button>'+
          '<button class="btn btn-primary" onclick="responderContra(\''+s.id+'\',true)">Aceitar</button>'+
        '</div></div>';
    }
    return '<div class="solic-wrap">'+topo+extra+'</div>';
  }
  window.setSolicTab = function(t){ solicTab=t; ir("solicitacoes"); };
  function solicNaTab(s){
    if(solicTab==="todas") return true;
    if(solicTab==="em_analise") return s.status==="em_analise" || s.status==="contraproposta";
    return s.status===solicTab; // aprovada | negada
  }
  // Os próprios indicadores funcionam como filtro (toque para filtrar),
  // conforme a referência — não há uma 2ª linha de abas separada no mockup.
  function statCardFiltro(ic,cls,val,cap,tabId){
    var active = solicTab===tabId;
    return '<button type="button" class="card stat-card stat-card-btn'+(active?' active':'')+'" onclick="setSolicTab(\''+tabId+'\')">'+
      '<span class="stat-ic '+cls+'">'+IC[ic]+'</span><div class="stat-txt"><span class="stat-cap">'+cap+'</span><span class="stat-val">'+val+'</span></div></button>';
  }
  function screenSolic(){
    // Indicadores: contagem total das solicitações do aluno (todo o histórico, não só os últimos 30 dias).
    var total=minhasSolicitacoes.length;
    var emAnalise=minhasSolicitacoes.filter(function(s){ return s.status==="em_analise"||s.status==="contraproposta"; }).length;
    var aprovadas=minhasSolicitacoes.filter(function(s){ return s.status==="aprovada"; }).length;
    var negadas=minhasSolicitacoes.filter(function(s){ return s.status==="negada"; }).length;
    var kpis='<div class="stat-row stat-row-4">'+
      statCardFiltro("agenda","si-teal",total,"Total","todas")+
      statCardFiltro("emAnalise","si-azul",emAnalise,"Em análise","em_analise")+
      statCardFiltro("checkCirc","si-verde",aprovadas,"Aprovadas","aprovada")+
      statCardFiltro("xcirc","si-dang",negadas,"Negadas","negada")+
      '</div><div class="pg-sub solic-resumo-nota">Totais de todo o seu histórico de solicitações. Toque em um indicador para filtrar.</div>';
    var nova='<div class="solic-cta-row"><button class="btn btn-primary btn-nova" onclick="novaSolicitacao()">'+IC.plus+' Nova solicitação</button>'+waPersonalBtn()+'</div>';
    var ordenadas = minhasSolicitacoes.slice()
      .filter(solicNaTab)
      .sort(function(x,y){ return (y.createdAt||"")<(x.createdAt||"")?-1:1; });
    var vazio = solicTab==="todas" ? "Você ainda não fez nenhuma solicitação." : "Nenhuma solicitação nesta categoria.";
    var lista = ordenadas.length ? ordenadas.map(cardSolicitacao).join("")
      : '<div class="lista-vazia">'+vazio+'</div>';
    return screenHero("Solicitações","Acompanhe o status das suas solicitações.","/img/hero-solicitacoes.webp",kpis)+nova+lista;
  }
  // Dispara push (não bloqueia a UI; falha silenciosa).
  function invocarPush(body){ try{ sb.functions.invoke("enviar-push", { body: body }).catch(function(){}); }catch(e){} }
  window.responderContra = async function(id, aceitar){
    var r = await sb.rpc("responder_contraproposta", { p_solic_id:id, p_aceitar: aceitar });
    if(r.error){ console.error(r.error); toast("Não foi possível: "+(r.error.message||"erro")); return; }
    invocarPush({ tipo:"contraproposta_respondida", solicitacao_id:id, aceitar:aceitar });
    await recarregarAposResposta();
    toast(aceitar ? "Horário confirmado! Aula remarcada." : "Sugestão recusada.");
    ir("solicitacoes");
  };
  async function recarregarAposResposta(){
    try{
      var au = await sb.from("aulas").select("id, data, hora, status, checkin_em, checkin_origem").eq("aluno_id", meuAlunoId);
      if(!au.error) aulas = (au.data||[]).map(function(r){ return {id:r.id,data:r.data,hora:(r.hora||"").slice(0,5),status:r.status,checkinEm:r.checkin_em||null,checkinOrigem:r.checkin_origem||null}; });
      var sr = await sb.from("solicitacoes").select("id, aula_id, tipo, data_sugerida, hora_sugerida, contra_data, contra_hora, status, created_at, resposta").eq("aluno_id", meuAlunoId);
      if(!sr.error) minhasSolicitacoes = (sr.data||[]).map(rowToSolic);
    }catch(e){ console.error(e); }
  }
  function dispHint(){
    if(!dispPersonal.length) return "";
    var ABREV=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"], byDay={};
    dispPersonal.forEach(function(d){ (byDay[d.dia]=byDay[d.dia]||[]).push(d.ini+"–"+d.fim); });
    var parts=[]; for(var i=0;i<7;i++){ if(byDay[i]) parts.push(ABREV[i]+" "+byDay[i].join(", ")); }
    return parts.length ? '<div class="modal-hint">Seu personal atende: '+parts.join(" · ")+'</div>' : "";
  }

  function getAula(id){ for(var i=0;i<aulas.length;i++) if(aulas[i].id===id) return aulas[i]; return null; }
  function addDias(ds,n){ var d=new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return dataLocalStr(d); }

  // ---- Modal de solicitação (remarcar / cancelar) ----
  window.fecharModalSolic = function(ev){ if(ev && ev.target && ev.target.id!=="modal-overlay" && ev.type==="click") return; document.getElementById("modal-overlay").hidden=true; };
  function abrirModal(html){ document.getElementById("modal-conteudo").innerHTML=html; document.getElementById("modal-overlay").hidden=false; }

  window.solicitarRemarcacao = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir remarcação</div>'+
      '<div class="modal-sub">Aula atual: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      dispHint()+
      '<div class="field"><label for="solic-data">Nova data</label><input id="solic-data" type="date" value="'+addDias(a.data,1)+'"></div>'+
      '<div class="field"><label for="solic-hora">Novo horário</label><input id="solic-hora" type="time" value="'+a.hora+'"></div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Ex.: tenho um compromisso nesse horário"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-primary" id="solic-enviar" onclick="enviarSolicitacao(\'remarcar\',\''+id+'\')">Enviar pedido</button></div>');
  };
  window.solicitarCancelamento = function(id){
    var a=getAula(id); if(!a) return;
    abrirModal(
      '<div class="modal-tit">Pedir cancelamento</div>'+
      '<div class="modal-sub">Aula: '+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)+' • '+a.hora+'</div>'+
      '<div class="field"><label for="solic-msg">Mensagem (opcional)</label><textarea id="solic-msg" placeholder="Conte o motivo, se quiser"></textarea></div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Voltar</button>'+
      '<button class="btn btn-dang" id="solic-enviar" onclick="enviarSolicitacao(\'cancelar\',\''+id+'\')">Enviar pedido</button></div>');
  };

  window.enviarSolicitacao = async function(tipo, aulaId){
    var msgEl=document.getElementById("solic-msg");
    var payload={ aluno_id:meuAlunoId, professor_id:meuProfessorId, aula_id:aulaId, tipo:tipo, mensagem:(msgEl&&msgEl.value.trim())||null };
    if(tipo==="remarcar"){
      var d=document.getElementById("solic-data").value, h=document.getElementById("solic-hora").value;
      if(!d||!h){ toast("Informe a nova data e o horário."); return; }
      payload.data_sugerida=d; payload.hora_sugerida=h;
    }
    var btn=document.getElementById("solic-enviar"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
    var r=await sb.from("solicitacoes").insert(payload).select().maybeSingle();
    if(r.error){ console.error(r.error); toast("Não foi possível enviar: "+(r.error.message||"erro")); if(btn){btn.disabled=false;btn.textContent="Enviar pedido";} return; }
    if(r.data){ minhasSolicitacoes.unshift(rowToSolic(r.data)); invocarPush({ tipo:"solicitacao_aberta", solicitacao_id:r.data.id }); }
    document.getElementById("modal-overlay").hidden=true;
    toast("Solicitação enviada ao personal.");
    ir("solicitacoes");
  };

  // ---- Modal "Ver detalhes da aula" (data, hora, personal, local) ----
  // Local = local de treino do cadastro; na falta dele, o endereço do aluno.
  var IC_PESSOA='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function detRow(ic,lab,val){ return '<div class="aula-det-row"><span class="aula-det-ic">'+ic+'</span><span class="aula-det-txt"><span class="aula-det-lab">'+lab+'</span><span class="aula-det-val">'+val+'</span></span></div>'; }
  window.verDetalhesAula = function(id){
    var a=getAula(id); if(!a) return;
    var e=enriquecer(a);
    var localTxt = meuTreinoLocal || meuEndereco || "";
    var localHtml = localTxt ? esc(localTxt) : '<span class="aula-det-faint">Local a combinar</span>';
    abrirModal(
      '<div class="modal-tit">Detalhes da aula</div>'+
      '<div class="modal-sub">'+e.titulo+' '+statusBadge(e.statusLabel)+'</div>'+
      '<div class="aula-det">'+
        detRow(IC.agenda,"Data",esc(capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data)))+
        detRow(IC.clock,"Horário",esc(a.hora))+
        detRow(IC_PESSOA,"Personal",esc(nomePersonal))+
        detRow(IC.pin,"Local",localHtml)+
      '</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="solicitarRemarcacao(\''+id+'\')">Remarcar</button>'+
      '<button class="btn btn-dang" onclick="solicitarCancelamento(\''+id+'\')">Cancelar</button></div>'+
      '<button class="btn btn-fechar-full" onclick="fecharModalSolic()">Fechar</button>');
  };

  // ---- Fluxo "Nova solicitação": escolher tipo, depois a aula ----
  window.novaSolicitacao = function(){
    abrirModal(
      '<div class="modal-tit">Nova solicitação</div>'+
      '<div class="modal-sub">O que você precisa?</div>'+
      '<div class="solic-opcoes">'+
        '<button class="solic-opcao" onclick="escolherAulaSolic(\'remarcar\')"><span class="solic-opcao-ic">'+IC.agenda+'</span><span class="solic-opcao-txt"><b>Remarcar uma aula</b><span>Sugerir nova data e horário</span></span><span class="solic-opcao-chev">'+IC.chevR+'</span></button>'+
        '<button class="solic-opcao" onclick="escolherAulaSolic(\'cancelar\')"><span class="solic-opcao-ic solic-opcao-ic-dang">'+IC.xcirc+'</span><span class="solic-opcao-txt"><b>Cancelar uma aula</b><span>Avisar que não poderá comparecer</span></span><span class="solic-opcao-chev">'+IC.chevR+'</span></button>'+
      '</div>'+
      '<button class="btn btn-fechar-full" onclick="fecharModalSolic()">Fechar</button>');
  };
  window.escolherAulaSolic = function(tipo){
    var prox=proximasAulas();
    var titulo = tipo==="cancelar" ? "Cancelar qual aula?" : "Remarcar qual aula?";
    var fn = tipo==="cancelar" ? "solicitarCancelamento" : "solicitarRemarcacao";
    if(!prox.length){
      abrirModal('<div class="modal-tit">'+titulo+'</div>'+
        '<div class="modal-sub">Você não tem aulas futuras para '+(tipo==="cancelar"?"cancelar":"remarcar")+'.</div>'+
        '<button class="btn btn-fechar-full" onclick="novaSolicitacao()">Voltar</button>');
      return;
    }
    var itens=prox.map(function(a){
      var e=enriquecer(a);
      return '<button class="solic-aula-item" onclick="'+fn+'(\''+a.id+'\')">'+
        '<span class="solic-aula-ic">'+tileTreino(e.tipo)+'</span>'+
        '<span class="solic-aula-txt"><b>'+capitalizar(diaSemanaLabel(a.data))+', '+fmtDataBR(a.data).slice(0,5)+' • '+esc(a.hora)+'</b><span>'+esc(e.titulo)+'</span></span>'+
        '<span class="solic-aula-chev">'+IC.chevR+'</span></button>';
    }).join("");
    abrirModal('<div class="modal-tit">'+titulo+'</div>'+
      '<div class="solic-aula-lista">'+itens+'</div>'+
      '<button class="btn btn-fechar-full" onclick="novaSolicitacao()">Voltar</button>');
  };

  /* =========================================================================
     TELA: Financeiro (cobranças REAIS; PIX real)
     ========================================================================= */
  // Para "pendente" com vencimento ainda no futuro, mostra "A vencer DD/MM"
  // em vez de só "Pendente" — a palavra sozinha soa como já vencido/em
  // atraso, o que confunde ao lado do aviso "está em dia" no topo da tela
  // (a cobrança não está atrasada, só ainda não chegou a data).
  function badgeCobranca(st, c){
    if(st==="pago")    return '<span class="badge badge-ok">Pago</span>';
    if(st==="vencido") return '<span class="badge badge-dang">Vencido</span>';
    var rotulo = (c && c.vencimento) ? "A vencer "+fmtDataBR(c.vencimento).slice(0,5) : "Pendente";
    return '<span class="badge badge-warn">'+rotulo+'</span>';
  }
  function detalheCobranca(c, st){
    if(st==="pago")    return (c.pagamento?("Pago em "+fmtDataBR(c.pagamento)):"Pago");
    if(st==="vencido") return (c.vencimento?("Venceu em "+fmtDataBR(c.vencimento)):"Em atraso");
    return (c.vencimento?("Vence em "+fmtDataBR(c.vencimento)):"Em aberto");
  }
  window.setFinTab = function(t){ finTab=t; ir("financeiro"); };
  /* ---- Pix copia-e-cola (BR Code EMV) ---------------------------------- */
  function soDigitos(s){ return (s||"").replace(/\D/g,""); }
  function semAcentoUpper(s){ return (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim(); }
  function crc16ccitt(str){
    var crc=0xFFFF;
    for(var i=0;i<str.length;i++){
      crc ^= (str.charCodeAt(i) & 0xFF) << 8;
      for(var j=0;j<8;j++){ crc = (crc & 0x8000) ? ((crc<<1) ^ 0x1021) : (crc<<1); crc &= 0xFFFF; }
    }
    return ("000"+crc.toString(16).toUpperCase()).slice(-4);
  }
  function tlv(id, val){ return id + ("0"+val.length).slice(-2) + val; }
  // Normaliza a chave conforme o tipo. Retorna null quando não dá para montar
  // com segurança (ex.: numérico sem tipo definido -> ambíguo CPF x telefone).
  function normalizarChavePix(chave, tipo){
    var c=(chave||"").trim(); tipo=(tipo||"").toLowerCase();
    if(!tipo){
      if(c.indexOf("@")>=0) tipo="email";
      else if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) tipo="aleatoria";
      else return null;
    }
    if(tipo==="email") return c.toLowerCase();
    if(tipo==="aleatoria") return c;
    if(tipo==="telefone"){ var d=soDigitos(c); if(d.indexOf("55")===0 && d.length>=12) return "+"+d; if(d.length>=10 && d.length<=11) return "+55"+d; return null; }
    if(tipo==="cpf"){ var cp=soDigitos(c); return cp.length===11?cp:null; }
    if(tipo==="cnpj"){ var cn=soDigitos(c); return cn.length===14?cn:null; }
    return null;
  }
  function montarPixCopiaECola(opts){
    var chave = normalizarChavePix(opts.chave, opts.tipo);
    if(!chave) return null;
    var nome = (semAcentoUpper(opts.nome).slice(0,25)) || "RECEBEDOR";
    var cidade = (semAcentoUpper(opts.cidade).slice(0,15)) || "BRASIL";
    var gui = tlv("26", tlv("00","br.gov.bcb.pix")+tlv("01",chave));
    var valor = (opts.valor!=null) ? Number(opts.valor).toFixed(2) : null;
    var payload = tlv("00","01")+gui+tlv("52","0000")+tlv("53","986")+
      (valor?tlv("54",valor):"")+tlv("58","BR")+tlv("59",nome)+tlv("60",cidade)+
      tlv("62", tlv("05","***"))+"6304";
    return payload + crc16ccitt(payload);
  }
  window.abrirPagamento = async function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var chave = pixPersonal || "(chave PIX não cadastrada)";
    var brcode = pixPersonal ? montarPixCopiaECola({ chave:pixPersonal, tipo:pixTipoPersonal, nome:nomePersonal, cidade:cidadePersonal, valor:c.valor }) : null;
    var blocoQR = "";
    if(brcode){
      var svg=""; try{ svg = await QRCode.toString(brcode, { type:"svg", margin:1, errorCorrectionLevel:"M" }); }catch(e){ svg=""; }
      blocoQR = (svg ? '<div class="pag-qr-cap">Escaneie no app do seu banco</div><div class="qr-panel pag-qr">'+svg+'</div>' : '')+
        '<div class="pag-pix-cap">Pix copia e cola</div>'+
        '<div class="pag-pix-row"><span class="pag-pix-key" id="pag-brcode">'+brcode+'</span>'+
        '<button class="btn btn-dark pag-copy" onclick="copiarTexto(\'pag-brcode\')">Copiar</button></div>';
    }
    var html='<div class="pag-modal">'+
      '<div class="modal-tit">Pagamento via Pix</div>'+
      '<div class="modal-sub">'+esc(c.label)+'</div>'+
      '<div class="pag-valor">'+fmtMoeda(c.valor)+'</div>'+
      blocoQR+
      '<div class="pag-pix"><div class="pag-pix-cap">'+(brcode?'Ou pague pela chave':'Chave Pix do seu personal')+'</div>'+
        '<div class="pag-pix-row"><span class="pag-pix-key" id="pag-pix-key">'+esc(chave)+'</span>'+
        '<button class="btn btn-dark pag-copy" onclick="copiarTexto(\'pag-pix-key\')">Copiar</button></div></div>'+
      '<div class="pag-hint">'+(brcode?'Escaneie o QR ou cole o código no app do seu banco (o valor já vai preenchido).':'Abra o app do seu banco, escolha <b>Pix por chave</b>, cole a chave e informe o valor acima.')+'</div>'+
      (c.pagoInformado
        ? '<div class="pag-informado">'+IC.check+' Você já avisou este pagamento. Aguarde a confirmação do seu personal.</div>'
        : '<button class="btn btn-primary block" onclick="informarPagamento(\''+c.id+'\')">'+IC.check+' Já fiz o pagamento</button>')+
      '<div class="modal-acoes"><button class="btn btn-dark block" onclick="fecharModalSolic()">Fechar</button></div></div>';
    abrirModal(html);
  };
  window.informarPagamento = async function(id){
    try{
      var r = await sb.rpc("informar_pagamento", { p_pagamento_id:id });
      if(r.error){ toast("Não foi possível avisar: "+(r.error.message||"erro")); return; }
      invocarPush({ tipo:"pagamento_informado", pagamento_id:id });
      minhasCobrancas.forEach(function(x){ if(x.id===id) x.pagoInformado=true; });
      document.getElementById("modal-overlay").hidden=true;
      toast("Avisamos seu personal! Ele vai confirmar o recebimento.");
      if(tabAtual==="financeiro") ir("financeiro");
      aplicarSino(document.getElementById("btn-bell"));
    }catch(e){ console.error(e); toast("Falha ao avisar o pagamento."); }
  };
  function aulasDaCobranca(c){
    return (c.aulaIds && c.aulaIds.length)
      ? aulas.filter(function(a){ return c.aulaIds.indexOf(a.id)>-1; }).sort(function(a,b){ return a.data<b.data?-1:1; })
      : [];
  }
  window.abrirComprovante = function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var doReceibo = aulasDaCobranca(c);
    var valorUnit = (meuPlanoCobranca==="por_aula") ? meuValorAula : null;
    var itens;
    if(doReceibo.length){
      itens = doReceibo.map(function(a){
        return '<div class="comp-item"><span>'+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+' · '+fmtDataBR(a.data)+' · '+a.hora+'</span>'+
          (valorUnit!==null?'<b>'+fmtMoeda(valorUnit)+'</b>':'')+'</div>';
      }).join("");
    } else {
      itens = '<div class="comp-item"><span>'+(c.referencia||c.label)+'</span><b>'+fmtMoeda(c.valor)+'</b></div>';
    }
    var html='<div class="comprovante">'+
      '<div class="modal-tit">Comprovante</div>'+
      '<div class="comp-card"><div class="comp-top"><span class="comp-ok">'+IC.check+'</span>'+
        '<div><div class="comp-status">Pagamento confirmado</div><div class="comp-ref">'+esc(c.label)+'</div></div></div>'+
        '<div class="comp-linha"><span>Aluno</span><b>'+esc(meuNome)+'</b></div>'+
        '<div class="comp-linha"><span>Personal</span><b>'+esc(nomePersonal)+'</b></div>'+
        (c.pagamento?'<div class="comp-linha"><span>Pago em</span><b>'+fmtDataBR(c.pagamento)+'</b></div>':'')+
        '<div class="comp-itens-tit">Serviços prestados</div>'+
        '<div class="comp-itens'+(doReceibo.length>=4?' cols-2':'')+'">'+itens+'</div>'+
        '<div class="comp-total"><span>Total pago</span><b>'+fmtMoeda(c.valor)+'</b></div>'+
      '</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="fecharModalSolic()">Fechar</button>'+
        '<button class="btn btn-primary" onclick="compartilharComprovante(\''+c.id+'\')">Compartilhar</button></div></div>';
    abrirModal(html);
  };
  window.compartilharComprovante = function(id){
    var c=null; minhasCobrancas.forEach(function(x){ if(x.id===id) c=x; });
    if(!c) return;
    var linhas = aulasDaCobranca(c).map(function(a){ return "  • "+capitalizar(diaSemanaLabel(a.data)).slice(0,3)+" "+fmtDataBR(a.data)+" "+a.hora; }).join("\n");
    var txt="Comprovante LT360\n"+c.label+"\nAluno: "+meuNome+"\nPersonal: "+nomePersonal+(c.pagamento?"\nPago em: "+fmtDataBR(c.pagamento):"")+(linhas?"\nServiços prestados:\n"+linhas:"")+"\nTotal pago: "+fmtMoeda(c.valor);
    if(navigator.share){ navigator.share({ title:"Comprovante LT360", text:txt }).catch(function(){}); }
    else { copiarTextoBruto(txt); }
  };
  function copiarTextoBruto(t){
    function ok(){ toast("Comprovante copiado!"); }
    try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(ok,function(){ok();}); } else { var ta=document.createElement("textarea"); ta.value=t; ta.style.position="absolute"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); ok(); } }catch(e){ toast("Copie manualmente."); }
  }
  window.copiarTexto = function(elId){
    var el=document.getElementById(elId); var txt=el?el.textContent:"";
    function ok(){ toast("Copiado!"); }
    function fallback(t){ try{ var ta=document.createElement("textarea"); ta.value=t; ta.setAttribute("readonly",""); ta.style.position="absolute"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); ok(); }catch(e){ toast("Não consegui copiar. Copie manualmente."); } }
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(ok, function(){ fallback(txt); }); } else fallback(txt); }
    catch(e){ fallback(txt); }
  };
  function kpisFinanceiro(vencidas, emAberto){
    var abertas = minhasCobrancas.filter(function(c){ return statusCobranca(c)!=="pago"; });
    var somaAberta = abertas.reduce(function(s,c){ return s+Number(c.valor||0); },0);
    var mesAtual = HOJE_STR.slice(0,7);
    var pagoNoMes = minhasCobrancas
      .filter(function(c){ return c.status==="pago" && c.pagamento && c.pagamento.slice(0,7)===mesAtual; })
      .reduce(function(s,c){ return s+Number(c.valor||0); },0);
    var card1 = statMiniCard("agenda", somaAberta>0?"si-amber":"si-verde", fmtMoeda(somaAberta), "Saldo em aberto");
    var card2 = vencidas.length
      ? statMiniCard("xcirc","si-dang", fmtMoeda(vencidas[0].valor), esc(vencidas[0].label)+" · vencida")
      : statMiniCard("check","si-verde", fmtMoeda(pagoNoMes), "Pago no mês");
    var card3 = emAberto.length
      ? statMiniCard("agenda","si-teal", fmtDataBR(emAberto[0].vencimento), esc(emAberto[0].label))
      : statMiniCard("agenda","si-teal", "—", "Sem vencimento futuro");
    return '<div class="stat-row stat-row-3">'+card1+card2+card3+'</div>';
  }
  function screenFinanceiro(){
    var tabs='<div class="seg">'+
      '<button class="seg-b'+(finTab==="cobrancas"?" active":"")+'" onclick="setFinTab(\'cobrancas\')">Cobranças</button>'+
      '<button class="seg-b'+(finTab==="historico"?" active":"")+'" onclick="setFinTab(\'historico\')">Histórico</button></div>';

    // Situação: vencidas, próxima em aberto (futura mais próxima).
    var vencidas = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="vencido"; });
    var emAberto = minhasCobrancas.filter(function(c){ return statusCobranca(c)==="pendente" && c.vencimento; })
                                  .sort(function(a,b){ return a.vencimento<b.vencimento?-1:1; });
    var kpis = finTab==="cobrancas" ? kpisFinanceiro(vencidas, emAberto) : "";
    var banner;
    if(vencidas.length){
      banner='<div class="fin-banner fin-banner-alerta"><span class="fin-banner-ic">'+IC.bell+'</span><div>'+
        '<div class="fin-banner-t">Você tem '+vencidas.length+' cobrança'+(vencidas.length>1?'s':'')+' em atraso</div>'+
        '<div class="fin-banner-s">Regularize com seu personal pelo PIX abaixo</div></div></div>';
    } else if(emAberto.length){
      banner='<div class="fin-banner"><span class="fin-banner-ic">'+IC.check+'</span><div>'+
        '<div class="fin-banner-t">Sua mensalidade está em dia!</div>'+
        '<div class="fin-banner-s">Próximo vencimento em '+fmtDataBR(emAberto[0].vencimento)+'</div></div></div>';
    } else {
      banner='<div class="fin-banner"><span class="fin-banner-ic">'+IC.check+'</span><div>'+
        '<div class="fin-banner-t">Nenhuma cobrança em aberto</div>'+
        '<div class="fin-banner-s">Você não tem pagamentos pendentes no momento</div></div></div>';
    }
    var heroExtra = (finTab==="cobrancas" ? banner : "") + tabs;

    // Cobranças = em aberto (pendente/vencido); Histórico = pagas.
    var ordenadas = minhasCobrancas.slice()
      .filter(function(c){
        var st=statusCobranca(c);
        return finTab==="historico" ? st==="pago" : st!=="pago";
      })
      .sort(function(a,b){
        return (b.vencimento||"")<(a.vencimento||"")?-1:1;  // mais recentes primeiro
      });
    var vazioFin = finTab==="historico" ? "Nenhum pagamento no histórico ainda." : "Nenhuma cobrança em aberto.";
    var cobr;
    if(!ordenadas.length){
      cobr='<div class="lista-vazia">'+vazioFin+'</div>';
    } else {
      cobr=ordenadas.map(function(c){
        var st=statusCobranca(c);
        var dot = st==="pago" ? "green" : (st==="vencido" ? "red" : "amber");
        var seloInf = (c.pagoInformado && st!=="pago") ? '<div class="cobr-inf">'+IC.clock+' Pagamento informado · aguardando confirmação</div>' : '';
        var acao = st==="pago"
          ? '<button class="btn btn-outline btn-pagar" onclick="abrirComprovante(\''+c.id+'\')">Comprovante</button>'
          : (c.valor>0
            ? '<button class="btn btn-primary btn-pagar" onclick="abrirPagamento(\''+c.id+'\')">'+IC.pix+' Pagar</button>'
            : ""); // valor R$ 0,00: sem regra de cobrança/baixa automática definida — não mostra ação de pagamento.
        return '<div class="card cobr-card"><div class="cobr-main"><div class="cobr-mes">'+esc(c.label)+'</div>'+
          '<div class="cobr-val">'+fmtMoeda(c.valor)+'</div>'+
          '<div class="cobr-det"><span class="cobr-dot '+dot+'"></span>'+detalheCobranca(c,st)+'</div>'+seloInf+'</div>'+
          '<div class="cobr-dir">'+badgeCobranca(st,c)+acao+'</div></div>';
      }).join("");
    }
    var pix = pixPersonal
      ? '<div class="card fin-pix"><div class="fin-pix-rot"><span class="cobr-pix-ic">'+IC.pix+'</span> Chave PIX do seu personal</div>'+
        '<div class="fin-pix-row"><div class="fin-pix-val" id="fin-pix-chave">'+esc(pixPersonal)+'</div>'+
        '<button class="btn btn-outline fin-pix-copy" onclick="copiarTexto(\'fin-pix-chave\')">'+IC.copiar+' Copiar</button></div></div>'
      : "";

    return screenHero("Financeiro","Acompanhe suas cobranças e histórico.","/img/hero-financeiro.webp",heroExtra)+kpis+cobr+pix;
  }

  /* =========================================================================
     TELA: Perfil (real; trocar senha real)
     ========================================================================= */
  function linhaPerfil(r,v){ return '<div class="perfil-linha"><span class="perfil-rot">'+r+'</span><span class="perfil-val">'+esc(v||"—")+'</span></div>'; }
  function screenPerfil(){
    var foto = meuFotoUrl
      ? '<div class="perfil-foto"><img class="avatar-img" src="'+esc(meuFotoUrl)+'" alt="Minha foto"></div>'
      : '<div class="perfil-foto">'+iniciais(meuNome)+'</div>';
    var acoesFoto = '<div class="perfil-foto-acoes">'+
      '<label class="btn btn-dark perfil-foto-btn">'+(meuFotoUrl?'Trocar foto':'Adicionar foto')+
        '<input type="file" accept="image/*" onchange="enviarFotoAluno(this)" hidden></label>'+
      (meuFotoUrl?'<button class="btn btn-dark" onclick="removerFotoAluno()">Remover</button>':'')+'</div>';
    var dados='<div class="perfil-foto-bloco">'+foto+acoesFoto+'</div>'+
      '<div class="perfil-dados">'+linhaPerfil("Nome",meuNome)+linhaPerfil("E-mail",meuEmail)+linhaPerfil("Telefone",meuTelefone)+linhaPerfil("Personal",nomePersonal)+'</div>'+
      '<h3 class="section-title">Notificações</h3><div id="notif-bloco" class="notif-bloco"><div class="notif-bloco-s">Verificando…</div></div>';
    var senha='<h3 class="section-title">Trocar senha</h3>'+
      '<form class="perfil-form" onsubmit="trocarSenha(event)"><div class="auth-erro" id="senha-erro" hidden></div><div class="auth-msg" id="senha-msg" hidden></div>'+
      '<div class="field"><label for="nova-senha">Nova senha</label><div class="input-ic"><input id="nova-senha" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"><button type="button" class="input-ic-eye" onclick="toggleSenha(\'nova-senha\')">&#128065;</button></div></div>'+
      '<div class="field"><label for="nova-senha-confirma">Confirmar nova senha</label><input id="nova-senha-confirma" type="password" autocomplete="new-password" placeholder="Repita a nova senha"></div>'+
      '<button type="submit" class="btn btn-primary" id="senha-submit">Salvar nova senha</button></form>';
    var sair='<button class="btn btn-dark block perfil-sair" onclick="sairDaConta()">'+IC.logout+' Sair da conta</button>';
    return '<div class="only-desktop pg-head"><h1>Meu perfil</h1></div>'+dados+senha+sair;
  }
  window.trocarSenha = async function(ev){
    ev.preventDefault();
    var nova=document.getElementById("nova-senha").value, conf=document.getElementById("nova-senha-confirma").value;
    var btn=document.getElementById("senha-submit");
    setErro("senha-erro",""); setErro("senha-msg","");
    if(nova.length<6){ setErro("senha-erro","A nova senha precisa ter pelo menos 6 caracteres."); return; }
    if(nova!==conf){ setErro("senha-erro","As senhas não coincidem."); return; }
    btn.disabled=true; btn.textContent="Salvando...";
    try{ var r=await sb.auth.updateUser({password:nova}); if(r.error) throw r.error;
      document.getElementById("nova-senha").value=""; document.getElementById("nova-senha-confirma").value="";
      setErro("senha-msg","Senha alterada com sucesso."); toast("Senha alterada.");
    } catch(err){ console.error(err); setErro("senha-erro",(err&&err.message)||"Não foi possível alterar a senha."); }
    finally{ btn.disabled=false; btn.textContent="Salvar nova senha"; }
  };
  var cropper = null, cropObjectUrl = null;
  // 1) Seleciona o arquivo -> abre o editor de recorte (círculo, zoom, girar).
  window.enviarFotoAluno = function(input){
    var file = input.files && input.files[0];
    if(!file) return;
    if(file.size > 8000000){ toast("Imagem muito grande. Use um arquivo de até 8MB."); input.value=""; return; }
    if(!/^image\//.test(file.type)){ toast("Selecione um arquivo de imagem."); input.value=""; return; }
    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch(e){} }
    cropObjectUrl = URL.createObjectURL(file);
    var html='<div class="crop-modal">'+
      '<div class="modal-tit">Ajustar foto</div>'+
      '<div class="modal-sub">Arraste para posicionar, use o zoom e gire se precisar.</div>'+
      '<div class="crop-area"><img id="crop-img" src="'+cropObjectUrl+'" alt=""></div>'+
      '<div class="crop-ctrls">'+
        '<button class="crop-ic" onclick="cropGirar()" aria-label="Girar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v4h-4"/></svg></button>'+
        '<input id="crop-zoom" class="crop-zoom" type="range" min="0" max="1" step="0.01" value="0" oninput="cropZoom(this.value)">'+
      '</div>'+
      '<div class="modal-acoes"><button class="btn btn-dark" onclick="cancelarRecorte()">Cancelar</button>'+
        '<button class="btn btn-primary" id="crop-ok" onclick="confirmarRecorteFoto()">Usar foto</button></div></div>';
    abrirModal(html);
    input.value="";
    var img = document.getElementById("crop-img");
    if(cropper){ try{ cropper.destroy(); }catch(e){} cropper=null; }
    cropper = new Cropper(img, {
      aspectRatio: 1, viewMode: 1, dragMode: "move", autoCropArea: 1,
      background: false, movable: true, zoomable: true, guides: true,
      cropBoxMovable: false, cropBoxResizable: false, toggleDragModeOnDblclick: false
    });
  };
  window.cropZoom = function(v){ if(cropper) cropper.zoomTo(Number(v)*2.5); };
  window.cropGirar = function(){ if(cropper) cropper.rotate(90); };
  window.cancelarRecorte = function(){
    if(cropper){ try{ cropper.destroy(); }catch(e){} cropper=null; }
    if(cropObjectUrl){ try{ URL.revokeObjectURL(cropObjectUrl); }catch(e){} cropObjectUrl=null; }
    document.getElementById("modal-overlay").hidden=true;
  };
  window.confirmarRecorteFoto = function(){
    if(!cropper) return;
    var btn=document.getElementById("crop-ok"); if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
    var canvas = cropper.getCroppedCanvas({ width:512, height:512, imageSmoothingQuality:"high", fillColor:"#0e141a" });
    canvas.toBlob(function(blob){
      if(!blob){ toast("Não consegui processar a imagem."); if(btn){btn.disabled=false;btn.textContent="Usar foto";} return; }
      uploadFotoBlob(blob);
    }, "image/jpeg", 0.9);
  };
  async function uploadFotoBlob(blob){
    toast("Enviando foto...");
    try{
      var sess = await sb.auth.getSession();
      var uid = sess.data.session && sess.data.session.user && sess.data.session.user.id;
      if(!uid) throw new Error("sem sessão");
      var caminho = uid + "/foto-" + Date.now() + ".jpg";
      var up = await sb.storage.from("fotos-alunos").upload(caminho, blob, { upsert:true, contentType:"image/jpeg" });
      if(up.error) throw up.error;
      var url = sb.storage.from("fotos-alunos").getPublicUrl(caminho).data.publicUrl;
      var r = await sb.rpc("definir_foto_aluno", { p_url: url });
      if(r.error) throw r.error;
      meuFotoUrl = url;
      cancelarRecorte();
      renderShell(); ir("perfil");
      toast("Foto atualizada!");
    }catch(err){ console.error(err); toast("Não consegui enviar a foto. Tente de novo.");
      var b=document.getElementById("crop-ok"); if(b){ b.disabled=false; b.textContent="Usar foto"; } }
  }
  window.removerFotoAluno = async function(){
    try{
      var r = await sb.rpc("definir_foto_aluno", { p_url: null });
      if(r.error) throw r.error;
      meuFotoUrl = null;
      renderShell(); ir("perfil");
      toast("Foto removida.");
    }catch(err){ console.error(err); toast("Não consegui remover a foto."); }
  };

  /* =========================================================================
     TELA: Avaliação física (real; só leitura — lançada pelo personal)
     ========================================================================= */
  function metricaAlunoInfo(id){
    return metricasCatalogoAluno.filter(function(x){ return x.id===id; })[0] || { nome:"Métrica", unidade:"", codigo:"" };
  }
  function itensDaAvaliacaoAluno(avaliacaoId){
    return minhasAvaliacoesItens.filter(function(it){ return it.avaliacaoId===avaliacaoId; });
  }
  // Mais recente primeiro; em caso de mesma data (duas avaliações no mesmo
  // dia) desempata por created_at — nunca por um horário inventado.
  function compararAvaliacoesDesc(a,b){
    if (a.data !== b.data) return a.data < b.data ? 1 : -1;
    var ca = a.createdAt || "", cb = b.createdAt || "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    return 0;
  }
  function dataLocalDeISO(iso){
    try{ return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso)); }
    catch(e){ return null; }
  }
  function horaLocalDeISO(iso){
    try{ return new Date(iso).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}); }
    catch(e){ return ""; }
  }
  // Só mostramos horário quando ele é confiável: created_at (quando a
  // avaliação foi de fato lançada no sistema) cai no mesmo dia-calendário que
  // data_avaliacao (o dia a que ela se refere). Se foi lançada com data
  // retroativa, não sabemos a que horas aconteceu — mostramos só a data.
  function rotuloDataAvaliacao(av){
    var dataBR = fmtDataBR(av.data);
    if (av.createdAt && dataLocalDeISO(av.createdAt) === av.data) return dataBR + " às " + horaLocalDeISO(av.createdAt);
    return dataBR;
  }
  function fmtNumPt(v){
    var n = Math.round(Number(v)*100)/100;
    return n.toString().replace(".", ",");
  }
  // Ícone específico por código quando o pacote oferece um; cai para o
  // genérico de perímetro (quadril, custom) ou de bioimpedância (custom).
  var ICONE_POR_CODIGO = {
    peso: "pesoM", altura: "alturaM",
    braco_direito: "bracoM", braco_esquerdo: "bracoM",
    coxa_direita: "coxaM", coxa_esquerda: "coxaM",
    panturrilha_direita: "panturrilhaM", panturrilha_esquerda: "panturrilhaM",
    cintura_escapular: "cinturaM", peitoral: "peitoralM", abdomen: "abdomenM",
    percentual_gordura_corporal: "gorduraM"
  };
  function iconParaMetrica(m){
    if (!m) return IC.percentM;
    var chave = ICONE_POR_CODIGO[m.codigo];
    if (chave) return IC[chave];
    if (m.categoria === "perimetro") return IC.perimetroM;
    return IC.percentM; // bioimpedância / custom sem ícone específico
  }
  // "Principais medidas": peso e altura sempre aparecem (com placeholder se
  // não lançados nesta avaliação) + até 2 outras métricas realmente medidas,
  // priorizando categoria (peso_altura > perímetro > bioimpedância > custom)
  // e depois nome — mesma prioridade usada no catálogo.
  function principaisMetricasAvaliacao(itens){
    var ordem = { peso_altura:0, perimetro:1, bioimpedancia:2, custom:3 };
    var porMetricaId = {};
    itens.forEach(function(it){ porMetricaId[it.metricaId] = it; });
    var destaque = [];
    ["peso","altura"].forEach(function(cod){
      var m = metricasCatalogoAluno.filter(function(x){ return x.codigo===cod; })[0];
      if (!m) return;
      destaque.push({ metrica:m, item: porMetricaId[m.id] || null });
    });
    var jaUsados = {};
    destaque.forEach(function(d){ jaUsados[d.metrica.id] = true; });
    var outros = itens.filter(function(it){ return !jaUsados[it.metricaId]; }).sort(function(a,b){
      var ma = metricaAlunoInfo(a.metricaId), mb = metricaAlunoInfo(b.metricaId);
      var oa = ordem[ma.categoria]===undefined?9:ordem[ma.categoria], ob = ordem[mb.categoria]===undefined?9:ordem[mb.categoria];
      if (oa !== ob) return oa - ob;
      return ma.nome < mb.nome ? -1 : (ma.nome > mb.nome ? 1 : 0);
    });
    outros.slice(0,2).forEach(function(it){ destaque.push({ metrica: metricaAlunoInfo(it.metricaId), item: it }); });
    return destaque;
  }
  function cardMetricaDestaque(d, itensAnterior){
    var m = d.metrica, it = d.item, icone = iconParaMetrica(m);
    if (!it){
      return '<div class="aval-dcard"><span class="aval-dcard-ic">'+icone+'</span><span class="aval-dcard-label">'+esc(m.nome)+'</span>'+
        '<span class="aval-dcard-valor aval-dcard-vazio">—</span><span class="aval-dcard-delta neutro">Não informado</span></div>';
    }
    var ant = itensAnterior.filter(function(x){ return x.metricaId===it.metricaId; })[0];
    var deltaHtml = '<span class="aval-dcard-delta neutro">Primeira medição</span>';
    if (ant){
      var delta = it.valor - ant.valor;
      deltaHtml = Math.abs(delta) < 0.005
        ? '<span class="aval-dcard-delta neutro">Sem alteração</span>'
        : '<span class="aval-dcard-delta">'+(delta>0?"+":"")+fmtNumPt(delta)+' '+esc(it.unidade)+'</span>';
    }
    return '<div class="aval-dcard"><span class="aval-dcard-ic">'+icone+'</span><span class="aval-dcard-label">'+esc(m.nome)+'</span>'+
      '<span class="aval-dcard-valor">'+fmtNumPt(it.valor)+' '+esc(it.unidade)+'</span>'+deltaHtml+'</div>';
  }
  function cardMedidaComparativo(it, itensAnterior){
    var m = metricaAlunoInfo(it.metricaId);
    var ant = itensAnterior.filter(function(x){ return x.metricaId===it.metricaId; })[0];
    var deltaHtml = '<span class="aval-comp-delta neutro">Primeira medição</span>';
    if (ant){
      var delta = it.valor - ant.valor;
      deltaHtml = Math.abs(delta) < 0.005
        ? '<span class="aval-comp-delta neutro">—</span>'
        : '<span class="aval-comp-delta">'+(delta>0?"+":"")+fmtNumPt(delta)+' '+esc(it.unidade)+'</span>';
    }
    return '<div class="aval-comp-card"><span class="cobr-det">'+esc(m.nome)+'</span>'+
      '<span class="aval-comp-valor">'+fmtNumPt(it.valor)+' '+esc(it.unidade)+'</span>'+deltaHtml+'</div>';
  }
  // Gráfico de evolução: área + linha + grid + rótulo de valor em cada ponto.
  // Cor única e neutra (var(--teal)) — nunca verde/vermelho: uma métrica
  // subir ou cair não é por si só "bom" ou "ruim" (depende do objetivo do aluno).
  // Rótulo com "chip" de fundo (evita colidir visualmente com grade/linha/eixo
  // atrás dele — o rect é opaco e desenhado por cima de tudo, então sempre
  // cobre o que estiver embaixo do texto).
  function svgChip(px, py, texto, anchor, opts){
    opts = opts || {};
    var fontSize = opts.fontSize || 11;
    var peso = opts.bold ? 700 : 600;
    var w = Math.max(fontSize*1.6, texto.length*fontSize*0.62 + 10);
    var h = fontSize + 7;
    var rectX = anchor==="start" ? px-4 : (anchor==="end" ? px-w+4 : px-w/2);
    var rectY = py - fontSize - 1;
    return '<rect x="'+rectX+'" y="'+rectY+'" width="'+w+'" height="'+h+'" rx="4" fill="'+(opts.fill||"var(--card)")+'"></rect>'+
      '<text x="'+px+'" y="'+py+'" font-size="'+fontSize+'" font-weight="'+peso+'" fill="'+(opts.color||"var(--fg)")+'" text-anchor="'+anchor+'">'+esc(texto)+'</text>';
  }
  function svgEvolucao(pontos, unidade, gradId){
    var w=640, h=230, padL=44, padR=20, padT=30, padB=44;
    var areaW = w-padL-padR, areaH = h-padT-padB;
    var valores = pontos.map(function(p){ return p.valor; });
    var min = Math.min.apply(null, valores), max = Math.max.apply(null, valores);
    if (min === max){ min -= 1; max += 1; }
    var folga = (max-min)*0.15; min -= folga; max += folga;
    var n = pontos.length;
    function x(i){ return padL + (n===1 ? areaW/2 : i*areaW/(n-1)); }
    function y(v){ return padT + (max-v)/(max-min)*areaH; }

    var nTicks = 5, grid = "", labelsY = "";
    for (var t=0;t<nTicks;t++){
      var v = max - (max-min)*t/(nTicks-1);
      var yy = padT + t*areaH/(nTicks-1);
      grid += '<line x1="'+padL+'" y1="'+yy+'" x2="'+(w-padR)+'" y2="'+yy+'" stroke="var(--card-line)" stroke-width="1"></line>';
      labelsY += '<text x="'+(padL-8)+'" y="'+(yy+3)+'" font-size="10" fill="var(--muted)" text-anchor="end">'+fmtNumPt(v)+'</text>';
    }

    var linePts = pontos.map(function(p,i){ return x(i)+","+y(p.valor); }).join(" ");
    var areaPts = linePts+" "+x(n-1)+","+(h-padB)+" "+x(0)+","+(h-padB);

    // Rótulos do eixo X: se os pontos estiverem muito próximos, mostra só
    // alguns (sempre o primeiro e o último) para não empilhar texto.
    var minSpacing = 58;
    var step = n>1 ? Math.max(1, Math.ceil(minSpacing / (areaW/(n-1)))) : 1;

    var dots="", valueLabels="", xLabels="";
    pontos.forEach(function(p,i){
      var px=x(i), py=y(p.valor);
      var rotulo = rotuloDataAvaliacao(p.av);
      var tituloAcessivel = rotulo+": "+fmtNumPt(p.valor)+" "+unidade;
      dots += '<circle cx="'+px+'" cy="'+py+'" r="5" tabindex="0" fill="var(--teal)" stroke="var(--bg)" stroke-width="2"><title>'+esc(tituloAcessivel)+'</title></circle>';
      var anchorV = i===0 ? "start" : (i===n-1 ? "end" : "middle");
      valueLabels += svgChip(px, py-14, fmtNumPt(p.valor)+" "+unidade, anchorV, { bold:true });
      if (i===0 || i===n-1 || i%step===0){
        var partes = rotulo.split(" às ");
        var anchorX = i===0 ? "start" : (i===n-1 ? "end" : "middle");
        xLabels += '<text x="'+px+'" y="'+(h-padB+17)+'" font-size="10" fill="var(--muted)" text-anchor="'+anchorX+'">'+esc(partes[0])+'</text>';
        if (partes[1]) xLabels += '<text x="'+px+'" y="'+(h-padB+30)+'" font-size="10" fill="var(--muted)" text-anchor="'+anchorX+'">'+esc(partes[1])+'</text>';
      }
    });

    return '<svg class="aval-chart" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet" style="width:100%;height:230px;display:block;" role="group" aria-label="Gráfico de evolução de '+esc(unidade)+'">'+
      '<defs><linearGradient id="'+gradId+'" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0%" stop-color="var(--teal)" stop-opacity="0.35"></stop>'+
      '<stop offset="100%" stop-color="var(--teal)" stop-opacity="0"></stop></linearGradient></defs>'+
      grid+labelsY+
      '<polygon points="'+areaPts+'" fill="url(#'+gradId+')"></polygon>'+
      '<polyline points="'+linePts+'" fill="none" stroke="var(--teal)" stroke-width="2.5"></polyline>'+
      dots+valueLabels+xLabels+'</svg>';
  }
  function cardHistoricoAluno(av){
    var itens = itensDaAvaliacaoAluno(av.id);
    var aberto = !!avalExpandidas[av.id];
    var pesoIt = itens.filter(function(it){ return metricaAlunoInfo(it.metricaId).codigo==="peso"; })[0];
    var alturaIt = itens.filter(function(it){ return metricaAlunoInfo(it.metricaId).codigo==="altura"; })[0];
    var resumo = [];
    if (pesoIt) resumo.push("Peso <b>"+fmtNumPt(pesoIt.valor)+" "+esc(pesoIt.unidade)+"</b>");
    if (alturaIt) resumo.push("Altura <b>"+fmtNumPt(alturaIt.valor)+" "+esc(alturaIt.unidade)+"</b>");
    resumo.push(itens.length+" medida"+(itens.length===1?"":"s"));
    var corpo = "";
    if (aberto){
      corpo = '<div class="aval-itens-mini">'+itens.map(function(it){
        var m = metricaAlunoInfo(it.metricaId);
        return '<div class="aval-item-mini"><span class="cobr-det">'+esc(m.nome)+'</span><span>'+fmtNumPt(it.valor)+' '+esc(it.unidade)+'</span></div>';
      }).join("")+'</div>'+
      (av.observacoes ? '<div class="cobr-det" style="margin-top:6px;">'+esc(av.observacoes)+'</div>' : '');
    }
    return '<div class="card aval-hist-card" onclick="toggleAvalExpandida(\''+av.id+'\')">'+
      '<div class="aval-hist-head"><span class="aval-hist-ic">'+IC.agenda+'</span>'+
      '<div class="aval-hist-info"><div class="aval-hist-data">'+rotuloDataAvaliacao(av)+'</div>'+
      '<div class="cobr-det">'+(av.aulaId?"Lançada durante uma aula":"Lançada fora de aula")+'</div></div>'+
      '<div class="aval-hist-resumo only-desktop">'+resumo.join(' <span class="aval-sep">|</span> ')+'</div>'+
      '<span class="aval-hist-chev'+(aberto?' aberto':'')+'">'+IC.chevD+'</span></div>'+corpo+'</div>';
  }
  function avalHero(subtitulo){
    return screenHero("Avaliação física", subtitulo, "/img/halteres-avaliacao.webp");
  }
  function screenAvaliacao(){
    if (minhasAvaliacoes.length===0){
      return avalHero()+
        '<div class="card" style="text-align:center;padding:28px 16px;">'+
        '<div class="section-title">Nenhuma avaliação ainda</div>'+
        '<div class="cobr-det">Seu personal ainda não registrou nenhuma avaliação física. Quando ele registrar, ela aparece aqui.</div></div>';
    }
    var ordenadas = minhasAvaliacoes.slice().sort(compararAvaliacoesDesc);
    var ultima = ordenadas[0];
    var anterior = ordenadas[1] || null;
    var itensUltima = itensDaAvaliacaoAluno(ultima.id);
    var itensAnterior = anterior ? itensDaAvaliacaoAluno(anterior.id) : [];
    var principais = principaisMetricasAvaliacao(itensUltima);
    var destaqueIds = {};
    principais.forEach(function(d){ if (d.item) destaqueIds[d.item.metricaId] = true; });

    var html = avalHero("Acompanhe sua evolução e histórico de medidas.");

    html += '<h3 class="section-title">Última avaliação — '+rotuloDataAvaliacao(ultima)+'</h3>';
    html += '<div class="card"><div class="aval-destaque-grid">';
    principais.forEach(function(d){ html += cardMetricaDestaque(d, itensAnterior); });
    html += '</div>';
    if (ultima.observacoes) html += '<div class="cobr-det" style="margin-top:10px;">'+esc(ultima.observacoes)+'</div>';
    html += '</div>';

    // Evolução: só vira opção no seletor a métrica com pelo menos 2 pontos.
    var contagem = {};
    minhasAvaliacoesItens.forEach(function(it){ contagem[it.metricaId] = (contagem[it.metricaId]||0)+1; });
    var metricasComEvolucao = metricasCatalogoAluno.filter(function(m){ return contagem[m.id] >= 2; });
    if (metricasComEvolucao.length){
      if (!avalMetricaSel || !contagem[avalMetricaSel]){
        var peso = metricasComEvolucao.filter(function(m){ return m.codigo==="peso"; })[0];
        avalMetricaSel = (peso || metricasComEvolucao[0]).id;
      }
      var metricaAtiva = metricaAlunoInfo(avalMetricaSel);
      var pontos = ordenadas.slice().reverse().map(function(av){
        var it = itensDaAvaliacaoAluno(av.id).filter(function(x){ return x.metricaId===avalMetricaSel; })[0];
        return it ? { av:av, valor:it.valor } : null;
      }).filter(Boolean);
      var opcoes = metricasComEvolucao.map(function(m){
        return '<option value="'+m.id+'"'+(m.id===avalMetricaSel?' selected':'')+'>'+esc(m.nome)+' ('+esc(m.unidade)+')</option>';
      }).join('');
      html += '<div class="card"><div class="aval-card-head"><h3 class="section-title" style="margin:0;">Evolução</h3>'+
        '<select class="aval-select" onchange="setAvalMetrica(this.value)">'+opcoes+'</select></div>'+
        svgEvolucao(pontos, metricaAtiva.unidade, "avalGrad-"+avalMetricaSel)+'</div>';
    }

    // Comparativo de medidas: tudo que não entrou no destaque acima.
    var outrasMedidas = itensUltima.filter(function(it){ return !destaqueIds[it.metricaId]; });
    if (outrasMedidas.length){
      var CAP = 6;
      var mostrarTodas = avalVerTodas || outrasMedidas.length <= CAP;
      var visiveis = mostrarTodas ? outrasMedidas : outrasMedidas.slice(0, CAP-1);
      html += '<h3 class="section-title">Comparativo de medidas</h3><div class="cobr-det" style="margin-top:-8px;margin-bottom:10px;">Diferença entre a última e a avaliação anterior.</div>';
      html += '<div class="aval-comp-grid">';
      visiveis.forEach(function(it){ html += cardMedidaComparativo(it, itensAnterior); });
      if (!mostrarTodas){
        html += '<button type="button" class="aval-vertodas" onclick="toggleAvalVerTodas()">'+IC.grid+'<span>Ver todas as medidas</span></button>';
      }
      html += '</div>';
    }

    html += '<h3 class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">Histórico de avaliações<span class="aval-contador">'+ordenadas.length+' avaliaç'+(ordenadas.length===1?'ão':'ões')+'</span></h3>';
    html += ordenadas.map(cardHistoricoAluno).join("");

    return html;
  }
  window.setAvalMetrica = function(id){ avalMetricaSel = id; ir("avaliacao"); };
  window.toggleAvalVerTodas = function(){ avalVerTodas = !avalVerTodas; ir("avaliacao"); };
  window.toggleAvalExpandida = function(id){ avalExpandidas[id] = !avalExpandidas[id]; ir("avaliacao"); };

  /* =========================================================================
     Navegação
     ========================================================================= */
  var SCREENS={ inicio:screenInicio, aulas:screenAulas, agenda:screenAgenda, solicitacoes:screenSolic, financeiro:screenFinanceiro, perfil:screenPerfil, avaliacao:screenAvaliacao };
  window.ir = function(id){
    tabAtual=id; document.body.setAttribute("data-tab",id);
    document.getElementById("sidebar-nav").innerHTML = NAV.map(function(n){ return '<button class="navitem'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="navitem-ic">'+IC[n.ic]+'</span>'+n.label+'</button>'; }).join("");
    document.getElementById("bottomnav").innerHTML = NAV.map(function(n){ return '<button class="bn-btn'+(n.id===tabAtual?' active':'')+'" onclick="ir(\''+n.id+'\')"><span class="bn-ic">'+IC[n.ic]+'</span><span class="bn-lb">'+n.label+'</span></button>'; }).join("");
    renderMHeader();
    renderDrawer();
    fecharMenu();
    var c=document.getElementById("content");
    c.innerHTML='<div class="screen screen-'+id+'">'+ (SCREENS[id]?SCREENS[id]():"") +'</div>';
    c.scrollTop=0;
    if(id==="perfil") renderNotifBloco();
    if(id==="aulas") iniciarCountdownAulas(); else pararCountdownAulas();
  };
  function renderAll(){ /* compat: entra pela ir() após login */ }

  /* ===================== MENU LATERAL MOBILE (drawer) ===================== */
  var _ndLastFocus = null;
  function _ndFocusables(){
    var p = document.querySelector("#nav-drawer .nd-panel");
    if(!p) return [];
    return Array.prototype.slice.call(p.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
      .filter(function(el){ return !el.disabled && el.offsetParent !== null; });
  }
  function _ndKeydown(e){
    if(e.key === "Escape"){ e.preventDefault(); fecharMenu(); return; }
    if(e.key !== "Tab") return;
    var f = _ndFocusables();
    if(!f.length) return;
    var first = f[0], last = f[f.length-1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  window.abrirMenu = function(){
    var d = document.getElementById("nav-drawer");
    if(!d || d.classList.contains("open")) return;
    _ndLastFocus = document.activeElement;
    d.classList.add("open");
    d.setAttribute("aria-hidden","false");
    var burger = document.querySelector(".nd-burger");
    if(burger) burger.setAttribute("aria-expanded","true");
    document.body.classList.add("nd-lock");
    document.addEventListener("keydown", _ndKeydown);
    var closeBtn = d.querySelector(".nd-close");
    if(closeBtn) setTimeout(function(){ closeBtn.focus(); }, 60);
  };
  window.fecharMenu = function(){
    var d = document.getElementById("nav-drawer");
    if(!d || !d.classList.contains("open")) return;
    d.classList.remove("open");
    d.setAttribute("aria-hidden","true");
    var burger = document.querySelector(".nd-burger");
    if(burger) burger.setAttribute("aria-expanded","false");
    document.body.classList.remove("nd-lock");
    document.removeEventListener("keydown", _ndKeydown);
    if(_ndLastFocus && _ndLastFocus.focus){ try{ _ndLastFocus.focus(); }catch(_){} }
    _ndLastFocus = null;
  };

})();
