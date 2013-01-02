messages = new Meteor.Collection('messages');
rooms = new Meteor.Collection('rooms');
invites  = new Meteor.Collection('invites');

function GUID () {
  var S4 = function ()
  {
    
    return Math.floor(
      Math.random() * 0x10000 /* 65536 */
    ).toString(16);
  };

  return (
    S4() + S4() + "-" +
      S4() + "-" +
      S4() + "-" +
      S4() + "-" +
      S4() + S4() + S4()
  );
};

Meteor.methods({
  joinroom: function(room, req){
    if (!Meteor.user().profile) {
      return;
    }

    var metaroom = rooms.findOne({name: room});
    if (!metaroom) {
      rooms.insert({name: room, peeps: {}});
    }
    metaroom = rooms.findOne({name: room});

    if (req) {
      var peeps = metaroom.peeps;

      peeps[Meteor.user().services.facebook.id] = 'offline';

      _.each(req.to, function(uid) {
        invites.insert({uid: uid, room: room});
        peeps[uid] = 'offline';
      });

      var toset = {
        peeps: peeps
      };

      rooms.update({_id: metaroom._id}, {$set: toset});
    }
    
    var me = Meteor.user().profile.name;
    messages.insert({name: me, text: '[[joined the room]]', room: room});
    if (!this.is_simulation) {
      Meteor.publish(room + '_stream', function(){
        return messages.find({room: room});
      });
      var toset = {};
      toset['rooms.' + room] = {};
      Meteor.users.update({_id: Meteor.userId()}, {$set: toset});
    }

    return room + '_made';
  }});


if (Meteor.isClient) {
  Meteor.startup(function () {

    window.fbAsyncInit = function() {
      // init the FB JS SDK
      FB.init({
        appId      : '250248971771865',
        status     : true, // check the login status upon init?
        cookie     : true, // set sessions cookies to allow your server to access the session?
        xfbml      : true,  // parse XFBML tags on this page?
        frictionlessRequests : true
      });
      Session.set('fb', FB);

      // Additional initialization code such as adding Event Listeners goes here

    };

    // Load the SDK's source Asynchronously
    // Note that the debug version is being actively developed and might 
    // contain some type checks that are overly strict. 
    // Please report such bugs using the bugs tool.
    (function(d, debug){
      var js, id = 'facebook-jssdk', ref = d.getElementsByTagName('script')[0];
      if (d.getElementById(id)) {return;}
      js = d.createElement('script'); js.id = id; js.async = true;
      js.src = "//connect.facebook.net/en_US/all" + (debug ? "/debug" : "") + ".js";
      ref.parentNode.insertBefore(js, ref);
    }(document, /*debug*/ false));

  });

  Template.myrooms.rooms = function(){
    return invites.find({});
  };

  Template.peeps.rpeeps = function(room) {
    var theroom = rooms.findOne({name: room});
    if (theroom) {
      return _.keys(theroom.peeps);   
    }
  };

  Template.room.rname = function(){
    return Session.get('room');
  };

  Template.room.messages = function () {
    return messages.find({room: Session.get('room')});
  };

  Template.room.events({
    'click .send' : function () {
      messages.insert({name: Meteor.user().profile.name, text: $('.message').val(), room: Session.get('room')});
    }
  });

  handleroom = function(){
    Meteor.autorun(function(h) {
      var fb = Session.get('fb');
      if (!fb) {
        return;
      }

      var room = Session.get('room');
      if (!room) {
        $(function(){
          setTimeout(function(){
            FB.ui({method: 'apprequests',
                   message: 'wants to chat with you'
                  }, function(req){
                    Session.set('req', req);
                    window.app_router.navigate(prompt('room name?'), { trigger: true });
                  });

          },1000);
        });
        return;
      }

      if (!Meteor.userId()) {
        $('.fb-modal').modal().show();
      }
      else {
        $('.fb-modal').modal('hide');
      }
      
      h.stop();
      console.log(Meteor.user(), 'joining', room);
      Meteor.call("joinroom", room, Session.get('req'), function(err, res){
        console.log('make room cb', room);

        if (err) {
          console.warn('makeroom', 'err: ', err, 'res', res);            
        }
        else {
          console.log('maderoom', 'res', res);
        }

        Meteor.subscribe(room + '_stream', function(){
          console.log('subscribed to', room);
        });

      });

    });

  };

  var AppRouter = Backbone.Router.extend({
    routes: {
      "new" : "gotoroom",
      "?request_ids=:reqs": "reqtoroom",
      ":room?:params": "room",
      ":room": "room"
    },
    reqtoroom: function(rids){
      var rid = decodeURIComponent(rids.split('&')[0]).split(',').splice(-1)[0];
      Meteor.subscribe('invitesData', function(e, data){
        console.log('invites data', data);
      });

      Meteor.subscribe('roomsData', function(e, data){
        console.log('rooms data', data);
      });

    },
    gotoroom: function(){      
      handleroom();
    },
    room: function(room) {
      Session.set('room', room);
      handleroom();
    } 
  });

  Meteor.subscribe('userData', function(){
    console.log('userData',arguments);
  });


  window.app_router = new AppRouter();

  Backbone.history.start({pushState: true});


}

if (Meteor.isServer) {
  Accounts.loginServiceConfiguration.remove({});

  Accounts.loginServiceConfiguration.insert({
    service: "facebook",
    appId: "250248971771865",
    secret: "a182dcc1d1ef991ac2ef87b72d7a461f"
  });

  Meteor.startup(function () {
    Meteor.publish("userData", function () {
      return Meteor.users.find({_id: this.userId}, {fields: {'rooms': 1, 'services.facebook': 1}});
    });



    Meteor.publish('invitesData', function(){
      var cuser = Meteor.users.findOne({_id: this.userId});
      var fbid = cuser && cuser.services && cuser.services.facebook ? cuser.services.facebook.id : '';
      return invites.find({uid: fbid});
    }); 

    
    Meteor.publish('roomsData', function(){
      var cuser = Meteor.users.findOne({_id: this.userId});
      var fbid = cuser && cuser.services && cuser.services.facebook ? cuser.services.facebook.id : '';
      if (!fbid) {
          return null;
      }

      var nvts = invites.find({uid: fbid});
      
      if (!nvts.count()) {
        throw 'wtf';
        return null;
      }

      var names = [];
      var roomz = {
          
      };

      nvts.forEach(function(nvt) {
          names.push({"name": nvt.room});
      });
 
      if (!names.length) {
          return null;
      }
      return rooms.find({$or: names});
    }); 

  });
}
